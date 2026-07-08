import type { Store, QueuedTurn } from '@intellilabs/core';
import { realSlackClient, realTeamsClient, recordModelInvocation, startModelInvocation, finishModelInvocation, recallMemories, searchRecentSummaries, normalizeProposal, saveTeamProposalResult, loadSkillBody, getConversation, listConversationMessages, getOrgById, type InvocationCostHook } from '@intellilabs/core';
import { saasInvocationCostHook } from '@intellilabs/billing';
import {
  ModelRegistry, anthropicProvider, googleProvider, googleVertexProvider, googleVertexAnthropicProvider, openaiCompatible,
  ToolRegistry, addTool, makeTeamSubmitProposal,
  CompositeToolExecutor, McpToolExecutor, IntegrationToolExecutor,
  vertexEmbeddingProvider, vertexBaseUrl, MemoryToolExecutor, RecentSearchToolExecutor, SkillToolExecutor,
  ConversationsReadToolExecutor, formatTranscript,
  runToText,
  costUsd,
  type GatewayClient, type ToolExecutor, type IntegrationToolsClient,
  type Dispatcher, type EngineDeps, type ModelEntry, type ModelProvider, type ModelRequest,
  type TurnTrace, type InvocationRecord, type InvocationStart,
} from '@intellilabs/engine';
import { summarizeTurn, SUMMARY_MODEL } from './summarize-turn.js';
import { makePlatformResolver, type VertexOpts } from './credential-resolver.js';
import { makeResolveEntry } from './resolve-entry.js';
import { makeSlackOnEvent, deliverSlackError, updateSlackMessage } from './slack-delivery.js';
import type { ReportConsumerDeps, ReportModelClient, ReportSlackUpdater } from '../routes/run-report.js';
import { makeTeamsOnEvent, deliverTeamsError } from './teams-delivery.js';
import { makeInternalOnEvent } from './internal-delivery.js';
import { makeApproval, makeOnSuspend } from './approval.js';
import { makeOnSubagent } from './subagent.js';
import { makeAgentSource } from './agent-source.js';
import { makeCreditsExhausted } from './credits-exhausted.js';
import { currentUsdEurRate, refreshUsdEurRate } from './fx.js';

export interface BuildEngineOpts {
  store: Store;
  geminiApiKey: string | undefined;
  vertex?: VertexOpts;
  secretsKey?: Buffer;
  teams?: { appId: string; appPassword: string; tenantId: string };
  dispatcher: Dispatcher;
  models: ModelEntry[];
  trace?: (turn: QueuedTurn) => TurnTrace;
  mcpGatewayClient?: GatewayClient;
  integrationToolsClient?: IntegrationToolsClient;
  /** Public base URL the report-gen consumer builds report links on (SERVER_BASE_URL). */
  reportBaseUrl?: string;
  /** Flip credits live: debit conversation AI + block on empty balance. Default off (inert). */
  creditsEnforced?: boolean;
  /** USD→EUR fallback used until the ECB feed lands. */
  fxFallbackRate?: number;
}

/** The decorated runtime: the engine deps the turn-runner needs, plus the dispatcher
 *  the handler uses to publish the next doorbell. */
export type EngineRuntime = EngineDeps & {
  dispatcher: Dispatcher;
  /** Edits the Slack placeholder to an error note when a slack turn fails/is cancelled. Undefined when secretsKey is not configured. */
  slackErrorSink?: (turn: QueuedTurn) => Promise<void>;
  /** Edits the Teams placeholder to an error note when a teams turn fails/is cancelled. Undefined when Microsoft app creds are not configured. */
  teamsErrorSink?: (turn: QueuedTurn) => Promise<void>;
  /**
   * Best-effort rolling conversation summarizer. Called after a turn completes.
   * Gated by the org `hindsightEnabled` flag; skips internal conversations.
   * Undefined when Vertex is not configured.
   */
  maybeSummarize?: (turn: QueuedTurn) => Promise<void>;
  /**
   * Dependencies for the report-gen Pub/Sub consumer (POST /api/internal/run-report): a one-shot
   * model client (HTML report writer) + a Slack message updater + the public base URL. Undefined
   * when Vertex is not configured (no model to generate with).
   */
  reportConsumer?: ReportConsumerDeps;
};

/** Turn payload → ModelRequest. The payload carries the model id and the message
 *  list the future caller built; for B1 we pass it straight through. */
function buildRequest(turn: QueuedTurn): ModelRequest {
  const p = turn.payload as { model: string; provider?: string | null; messages?: ModelRequest['messages']; maxOutputTokens?: number; temperature?: number };
  return { model: p.model, provider: p.provider ?? null, messages: p.messages ?? [], maxOutputTokens: p.maxOutputTokens, temperature: p.temperature };
}

/** No-op ToolExecutor used when MCP gateway is not configured. */
const EMPTY_MCP: ToolExecutor = {
  toToolDefs: () => Promise.resolve([]),
  execute: async (c) => ({ toolCallId: c.id, name: c.name, content: 'mcp disabled', isError: true }),
};

export function buildEngineDeps(opts: BuildEngineOpts): EngineRuntime {
  const store = opts.store;
  const db = store.db;

  if (opts.creditsEnforced) void refreshUsdEurRate(db, opts.fxFallbackRate ?? 0.92);

  const providers = new Map<string, ModelProvider>([
    [googleProvider.id, googleProvider],
    [googleVertexProvider.id, googleVertexProvider],
    [googleVertexAnthropicProvider.id, googleVertexAnthropicProvider],
    [openaiCompatible.id, openaiCompatible],
    [anthropicProvider.id, anthropicProvider],
  ]);

  const registry = new ModelRegistry(opts.models);
  const builtins = new ToolRegistry([addTool]);
  const memoryClient = opts.vertex
    ? {
        recall: async (orgId: string, projectId: string, assistantId: string, query: string, limit?: number): Promise<string> => {
          const apiKey = await opts.vertex!.getAccessToken();
          const [embedding] = await vertexEmbeddingProvider.embed([query], { apiKey, baseUrl: vertexBaseUrl(opts.vertex!.project, opts.vertex!.location) });
          if (!embedding) return '';
          const memories = await recallMemories(store, { orgId, projectId, assistantId, queryEmbedding: embedding, limit });
          if (memories.length === 0) return '';
          return memories.map((m) => `- (${m.scope}) ${m.content}`).join('\n');
        },
      }
    : undefined;
  const recentSearchClient = opts.vertex
    ? {
        search: async (orgId: string, projectId: string, query: string, excludeConversationId: string | undefined, limit?: number): Promise<string> => {
          const apiKey = await opts.vertex!.getAccessToken();
          const [embedding] = await vertexEmbeddingProvider.embed([query], { apiKey, baseUrl: vertexBaseUrl(opts.vertex!.project, opts.vertex!.location) });
          if (!embedding) return '';
          const rows = await searchRecentSummaries(store, { orgId, projectId, queryEmbedding: embedding, excludeConversationId, limit });
          return rows.length ? rows.map((r) => `- [${r.status}] (${r.id}) ${r.summary}`).join('\n') : '';
        },
      }
    : undefined;
  const skillClient = {
    load: (projectId: string, assistantId: string, name: string): Promise<string | null> =>
      loadSkillBody(db, projectId, assistantId, name),
  };
  const conversationsClient = {
    read: async (projectId: string, conversationId: string): Promise<string | null> => {
      const convo = await getConversation(db, conversationId);
      if (!convo || convo.projectId !== projectId) return null;       // hard project-scope boundary
      const msgs = await listConversationMessages(db, conversationId);
      return formatTranscript(msgs);
    },
  };
  const summarizerLlm = opts.vertex
    ? async (prompt: string) => {
        const apiKey = await opts.vertex!.getAccessToken();
        return runToText(
          googleVertexProvider,
          { model: SUMMARY_MODEL, messages: [{ role: 'user', content: prompt }], maxOutputTokens: 1024 },
          { apiKey, baseUrl: vertexBaseUrl(opts.vertex!.project, opts.vertex!.location) },
        );
      }
    : undefined;
  const slackDeps = opts.secretsKey
    ? { db: db, secretsKey: () => opts.secretsKey!, client: realSlackClient }
    : undefined;

  // Report-gen consumer deps: a one-shot HTML-report model call (mirrors the hindsight summarizer's
  // Vertex model), a Slack message updater (edits the offer message into the report link), and the
  // public base URL. Only available when Vertex is configured (no model → no report generation).
  const reportModel: ReportModelClient | undefined = opts.vertex
    ? {
        complete: async (_orgId: string, prompt: string) => {
          const apiKey = await opts.vertex!.getAccessToken();
          const res = await runToText(
            googleVertexProvider,
            { model: SUMMARY_MODEL, messages: [{ role: 'user', content: prompt }], maxOutputTokens: 8192 },
            { apiKey, baseUrl: vertexBaseUrl(opts.vertex!.project, opts.vertex!.location) },
          );
          return { text: res.text, model: SUMMARY_MODEL, costUsd: costUsd(SUMMARY_MODEL, res.inputTokens, res.outputTokens).toFixed(6) };
        },
      }
    : undefined;
  const reportSlack: ReportSlackUpdater = slackDeps
    ? { update: (orgId, channel, ts, text) => updateSlackMessage(slackDeps, orgId, channel, ts, text) }
    : { update: async () => { /* Slack not configured */ } };
  const reportConsumer: ReportConsumerDeps | undefined = reportModel
    ? { db, model: reportModel, slack: reportSlack, baseUrl: opts.reportBaseUrl ?? '' }
    : undefined;
  const slackEvent = slackDeps ? makeSlackOnEvent(slackDeps) : undefined;
  const teamsDeps = opts.teams ? { db, client: realTeamsClient, auth: opts.teams } : undefined;
  const teamsEvent = teamsDeps ? makeTeamsOnEvent(teamsDeps) : undefined;
  const internalEvent = makeInternalOnEvent(db);

  return {
    db: db,
    registry,
    providers,
    credentials: makePlatformResolver({
      geminiApiKey: opts.geminiApiKey, vertex: opts.vertex,
      byok: opts.secretsKey ? { db: db, secretsKey: opts.secretsKey } : undefined,
    }),
    resolveEntry: makeResolveEntry(registry, db, opts.secretsKey !== undefined),
    buildRequest,
    dispatcher: opts.dispatcher,
    onEvent: async (turn, ev) => {
      if (slackEvent) await slackEvent(turn, ev);
      if (teamsEvent) await teamsEvent(turn, ev);
      await internalEvent(turn, ev);
    },
    approval: makeApproval(db),
    onSuspend: slackDeps ? makeOnSuspend(slackDeps) : undefined,
    onSubagent: makeOnSubagent(db, opts.dispatcher.publish.bind(opts.dispatcher)),
    // Best-effort: record EVERY conversation model call (full messages + output + usage).
    // The lane id IS the conversation id for end-user turns; for internal/sub-agent turns
    // it is the (real) conversation id of that lane. Recording never affects the turn.
    creditsExhausted: makeCreditsExhausted(db, { enforced: opts.creditsEnforced ?? false }),
    recorderFor: (turn: QueuedTurn) => {
      const meta = {
        source: 'conversation',
        orgId: turn.orgId,
        conversationId: turn.laneId,
      };
      // Two-phase: `start` writes a 'running' row (with full messages) BEFORE the call so it shows
      // live; `finish` completes it. If start failed (null id), finish inserts the whole record.
      const recorder = {
        start: (s: InvocationStart): Promise<string | null> => startModelInvocation(db, {
          source: s.source, orgId: s.orgId ?? null, provider: s.provider ?? null,
          conversationId: s.conversationId ?? null, buildId: s.buildId ?? null, phase: s.phase ?? null,
          model: s.model, messages: s.messages,
        }),
        finish: (rec: InvocationRecord, id: string | null): void => {
          const cost = rec.status === 'ok' ? costUsd(rec.model, rec.inputTokens, rec.outputTokens).toFixed(6) : null;
          if (opts.creditsEnforced) void refreshUsdEurRate(db, opts.fxFallbackRate ?? 0.92);
          const fallback = opts.fxFallbackRate ?? 0.92;
          const onCost: InvocationCostHook = saasInvocationCostHook(db, {
            creditsEnforced: opts.creditsEnforced ?? false,
            fxRate: async () => opts.creditsEnforced ? currentUsdEurRate(fallback) : null,
          });
          if (id) {
            void finishModelInvocation(db, id, {
              output: rec.output, inputTokens: rec.inputTokens, outputTokens: rec.outputTokens,
              costUsd: cost, latencyMs: rec.latencyMs, status: rec.status, error: rec.error ?? null,
              rateLimited: rec.rateLimited ?? false,
            }, { onCost });
          } else {
            void recordModelInvocation(db, {
              source: rec.source, orgId: rec.orgId ?? null, provider: rec.provider ?? null,
              conversationId: rec.conversationId ?? null, model: rec.model, messages: rec.messages,
              output: rec.output, inputTokens: rec.inputTokens, outputTokens: rec.outputTokens,
              costUsd: cost, latencyMs: rec.latencyMs, status: rec.status, error: rec.error ?? null,
              rateLimited: rec.rateLimited ?? false,
            }, { onCost });
          }
        },
      };
      return { recorder, meta };
    },
    subagentResultsFor: (turn) =>
      (turn.payload as { subagentResults?: Record<string, string> }).subagentResults,
    childConversationIdsFor: (turn) =>
      (turn.payload as { childConversationIds?: Record<string, string> }).childConversationIds,
    agentLoop: {
      toolsFor: (turn: QueuedTurn) => {
        const p = turn.payload as { projectId?: string; assistantId?: string; proposalId?: string; slack?: { channel: string; threadTs: string } };
        // Analysis-orchestrator turns carry a proposalId: give them team.submit_proposal, which
        // validates + persists the designed team. Normal turns use the static builtins registry.
        const builtinsForTurn = p.proposalId
          ? new ToolRegistry([
              addTool,
              makeTeamSubmitProposal(async (raw) => {
                const doc = normalizeProposal(raw); // throws on invalid → reported back to the agent
                await saveTeamProposalResult(db, p.proposalId!, { proposal: doc, buildId: null });
              }),
            ])
          : builtins;
        const agents = makeAgentSource(db, turn.orgId, p.projectId, p.assistantId);
        const mcp = opts.mcpGatewayClient ? new McpToolExecutor(opts.mcpGatewayClient, turn.orgId) : EMPTY_MCP;
        // Slack-triggered turns can reply in their own thread; surface that as integration context.
        const context = turn.source === 'slack' && p.slack
          ? { slackThread: { channel: p.slack.channel, threadTs: p.slack.threadTs } }
          : undefined;
        const integrations = opts.integrationToolsClient
          ? new IntegrationToolExecutor(opts.integrationToolsClient, turn.orgId, p.projectId, context)
          : undefined;
        const memory = memoryClient && p.projectId && p.assistantId
          ? new MemoryToolExecutor(memoryClient, turn.orgId, p.projectId, p.assistantId)
          : undefined;
        const recent = (recentSearchClient && p.projectId)
          ? new RecentSearchToolExecutor(recentSearchClient, turn.orgId, p.projectId, turn.laneId)
          : undefined;
        const skill = p.projectId && p.assistantId
          ? new SkillToolExecutor(skillClient, p.projectId, p.assistantId)
          : undefined;
        const conversations = p.projectId
          ? new ConversationsReadToolExecutor(conversationsClient, p.projectId)
          : undefined;
        return new CompositeToolExecutor(builtinsForTurn, mcp, agents, integrations, memory, recent, skill, conversations);
      },
      toolNamesFor: (turn: QueuedTurn) => {
        // team.submit_proposal is only EXECUTABLE when the payload carries proposalId (see toolsFor's
        // builtinsForTurn). Never advertise it without one, or the model calls a tool the executor
        // can't run → "unknown tool". Keeps advertised names == executable tools.
        const p = turn.payload as { enabledTools?: string[]; proposalId?: string };
        const names = p.enabledTools ?? [];
        return p.proposalId ? names : names.filter((n) => n !== 'team.submit_proposal');
      },
    },
    trace: opts.trace,
    slackErrorSink: slackDeps
      ? (turn: QueuedTurn) => deliverSlackError(slackDeps, turn)
      : undefined,
    teamsErrorSink: teamsDeps
      ? (turn: QueuedTurn) => deliverTeamsError(teamsDeps, turn)
      : undefined,
    maybeSummarize: summarizerLlm
      ? async (turn: QueuedTurn) => {
          try {
            await summarizeTurn({
              db: db,
              llm: summarizerLlm,
              vector: store.vector,
              embed: async (text: string) => {
                const apiKey = await opts.vertex!.getAccessToken();
                const [v] = await vertexEmbeddingProvider.embed([text], { apiKey, baseUrl: vertexBaseUrl(opts.vertex!.project, opts.vertex!.location) });
                return v ?? [];
              },
            }, turn);
          } catch { /* best-effort: never break the turn */ }
        }
      : undefined,
    reportConsumer,
  };
}
