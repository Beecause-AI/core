import {
  startOrReuseOperation, finishOperation, setOperationConversation,
  getConnectedIntegrations,
  setTeamProposalStatus, setTeamProposalProgress, setTeamProposalFacts,
  createConversation, enqueueTurn, getTeamProposal, incidentRollup,
  getAnalysisAgent, selectFleet,
  detectSignalsFromSnapshot, listSignalSkills, computeGaps,
  makeLogger,
  type TeamAutogenJob, type Facts, type RepoSnapshot,
} from '@intellilabs/core';

const log = makeLogger({ service: 'graph-builder', projectId: process.env.GCP_PROJECT_ID ?? 'local' });
import { buildProjectSnapshot, type SnapshotDeps } from './team-snapshot.js';

export interface TeamAutogenDeps extends SnapshotDeps {
  /** Rings the engine-worker doorbell for an enqueued turn. Required in prod; undefined only in
   *  unit tests with no Pub/Sub topic — then the fleet can't run and generation fails fast. */
  publishTurn?: (laneId: string, turnId: string) => Promise<void>;
}

const AGENTIC_POLL_MS = 3000;
const AGENTIC_TIMEOUT_MS = 480_000; // ~8 min: generous headroom (no digest fallback now), under the 600s push ack
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The orchestrator's kickoff message: the task + a deterministic seed (detected products + gaps) +
 *  how to investigate. Sequential, knowledge-building delegation is deliberate — each specialist's
 *  findings sharpen the next question, which is more powerful than blind parallel reconnaissance. */
export function buildOrchestratorKickoff(
  connected: { gcp: boolean; cloudflare: boolean; aws: boolean; azure: boolean; datadog: boolean; dynatrace: boolean; pagerduty: boolean },
  signalMap: { product: string }[],
  gaps: { title: string }[],
): string {
  const domains = [connected.gcp && 'GCP', connected.cloudflare && 'Cloudflare', connected.aws && 'AWS', connected.azure && 'Azure', connected.datadog && 'Datadog', connected.dynatrace && 'Dynatrace', connected.pagerduty && 'PagerDuty'].filter(Boolean).join(', ') || 'none';
  const products = [...new Set(signalMap.map((s) => s.product))];
  const seed: string[] = [];
  if (products.length) seed.push(`Detected products/signals from a deterministic scan (a STARTING MAP — verify with the specialists, do not trust blindly): ${products.join(', ')}.`);
  if (gaps.length) seed.push(`Detected observability gaps: ${gaps.map((g) => g.title).join('; ')}. Include these in the proposal's gaps[].`);
  return [
    'Design the RCA assistant team for this project.',
    'The team must be built to do RCA: above all, to pinpoint the specific code change (commit/PR) that caused an incident, and to conclude every investigation with recommended actions — an immediate mitigation when sensible plus the root-cause fix. Reflect this mission in the personas you write (the lead owns the synthesis; the code specialist hunts recent changes).',
    `Connected observability domains: ${domains}.`,
    ...seed,
    'Delegate to your specialist analysts (agent.sys.analysis.*) ONE at a time. Give each a BROAD mandate — have it investigate its WHOLE domain thoroughly and report a comprehensive map, deciding for itself what an RCA team needs (do NOT micro-manage with narrow questions). Pass earlier findings forward as context so later specialists BUILD ON them; one thorough pass per specialist is usually enough — reserve any follow-up for a genuine cross-domain question.',
    'When the picture is complete, call team.submit_proposal exactly once with the final team.',
  ].join('\n');
}

/**
 * Run the analysis as an engine-worker fleet: create a root conversation, enqueue the
 * orchestrator turn (which delegates to connected-domain specialists and calls
 * team.submit_proposal), ring the doorbell, then poll until the proposal is stored.
 * Returns true if the fleet produced a ready proposal; false → caller falls back to the digest
 * pipeline. Never throws (errors → false → fallback).
 */
async function tryAgenticFleet(
  deps: TeamAutogenDeps, job: TeamAutogenJob, operationId: string,
  connected: { github: boolean; gcp: boolean; cloudflare: boolean; aws: boolean; azure: boolean; datadog: boolean; dynatrace: boolean; pagerduty: boolean },
  snap: { snapshot: RepoSnapshot; digest: string },
): Promise<string | null> {
  if (!deps.publishTurn) return null;
  try {
    const orch = getAnalysisAgent('analysis.orchestrator');
    if (!orch) return null;
    const specialists = selectFleet(connected).filter((a) => a.role === 'specialist');
    const enabledTools = [...orch.tools, ...specialists.map((s) => `agent.sys.${s.key}`)];

    const convo = await createConversation(deps.db, {
      orgId: job.orgId, projectId: job.projectId, assistantId: null, source: 'internal',
    });
    await setOperationConversation(deps.db, operationId, convo.id); // op page surfaces the fleet tree

    // Deterministic seed (no LLM): detect products/signals + gaps from the snapshot, persist them as
    // the proposal's facts (so gaps surface even though the agentic submit tool doesn't compute them),
    // and seed the orchestrator so specialists VERIFY rather than rediscover from scratch.
    const signalMap = detectSignalsFromSnapshot(listSignalSkills(), snap.snapshot);
    const gaps = computeGaps(signalMap, { gcp: connected.gcp, cloudflare: connected.cloudflare, aws: connected.aws, azure: connected.azure, datadog: connected.datadog, dynatrace: connected.dynatrace, pagerduty: connected.pagerduty });
    const availableTools = [...new Set(signalMap.flatMap((s) => s.signals.map((x) => x.tool)))];
    const facts: Facts = { components: [], codeComplexity: 'medium', signalMap, customMetrics: [], gaps, availableTools };
    await setTeamProposalFacts(deps.db, job.proposalId, facts);

    const kickoff = buildOrchestratorKickoff({ gcp: connected.gcp, cloudflare: connected.cloudflare, aws: connected.aws, azure: connected.azure, datadog: connected.datadog, dynatrace: connected.dynatrace, pagerduty: connected.pagerduty }, signalMap, gaps);

    const turn = await enqueueTurn(deps.db, {
      laneId: convo.id, orgId: job.orgId, source: 'api',
      payload: {
        model: orch.model, provider: 'platform',
        messages: [{ role: 'system', content: orch.persona }, { role: 'user', content: kickoff }],
        enabledTools, assistantId: null, systemAgentKey: orch.key,
        projectId: job.projectId, proposalId: job.proposalId, rootConversationId: convo.id, depth: 0,
        // Bound + stabilize the orchestrator's structured output (proposal JSON).
        maxOutputTokens: 8192, temperature: 0.2,
      },
    });
    await setTeamProposalProgress(deps.db, job.proposalId, 'analyzing');
    await deps.publishTurn(convo.id, turn.id);

    const start = Date.now();
    while (Date.now() - start < AGENTIC_TIMEOUT_MS) {
      await sleep(AGENTIC_POLL_MS);
      const p = await getTeamProposal(deps.db, job.proposalId);
      if (p?.status === 'ready' && p.proposal) return convo.id; // submit tool stored + marked ready
    }
    log.error({ proposalId: job.proposalId }, '[team-autogen] agentic fleet timed out for proposal');
    return null;
  } catch (e) {
    log.error({ proposalId: job.proposalId, err: e }, '[team-autogen] agentic fleet error for proposal');
    return null;
  }
}

export async function runTeamAutogen(deps: TeamAutogenDeps, job: TeamAutogenJob): Promise<void> {
  // Idempotency: a redelivered job for an already-finished proposal must NOT restart the design —
  // that would wipe the in-progress/completed fleet conversation and re-run from scratch. No-op so
  // the push is acked.
  const existing = await getTeamProposal(deps.db, job.proposalId);
  if (existing && (existing.status === 'ready' || existing.status === 'applied')) return;

  const op = await startOrReuseOperation(deps.db, { orgId: job.orgId, projectId: job.projectId, kind: 'team-autogen', refId: job.proposalId });
  try {
    const snap = await buildProjectSnapshot(deps, job.orgId, job.projectId);
    if (!snap) throw new Error('no connected code source (GitHub integration + at least one repo required)');

    const integ = await getConnectedIntegrations(deps.db, job.orgId, job.projectId);
    const connected = { gcp: integ.gcp.length > 0, cloudflare: integ.cloudflare.length > 0, aws: integ.aws.length > 0, azure: integ.azure.length > 0, datadog: integ.datadog.length > 0, dynatrace: integ.dynatrace.length > 0, pagerduty: integ.pagerduty.length > 0 };

    // v3-only: the agentic fleet (tool-using analysis via engine-worker) designs the team. Its
    // submit tool stores the proposal + marks it ready; we just confirm. There is NO digest
    // fallback — if the fleet can't complete (disabled/timeout/error), the proposal is marked
    // failed (catch below) and the user retries.
    const fleetConvoId = await tryAgenticFleet(deps, job, op.id, { github: true, ...connected }, snap);
    if (!fleetConvoId) throw new Error('The analysis fleet could not complete the team design. Please try again.');

    // Roll up the fleet's real COST from the run conversation tree (the agentic op used to report
    // 0). incidentRollup sums model_invocations cost across the root + sub-agent children. Token
    // totals are omitted: a (conversationId, inputTokens, outputTokens) sum-aggregate would need a
    // composite index that isn't deployed, and incidentRollup is also used live for AI-activity.
    const rollup = await incidentRollup(deps.db, fleetConvoId);
    await finishOperation(deps.db, op.id, { status: 'done', error: null, costUsd: rollup.costUsd, inputTokens: 0, outputTokens: 0 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ proposalId: job.proposalId, err: e instanceof Error ? e : new Error(String(e)) }, '[team-autogen] generation failed for proposal');
    await setTeamProposalStatus(deps.db, job.proposalId, 'failed', { error: msg });
    await finishOperation(deps.db, op.id, { status: 'failed', error: msg, costUsd: '0', inputTokens: 0, outputTokens: 0 });
    throw e;
  }
}
