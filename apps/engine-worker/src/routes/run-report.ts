import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import {
  getReportOffer,
  markReportOfferGenerated,
  markReportOfferFailed,
  buildConversationThread,
  createConversationReport,
  generateReportHtml,
  getOrgById,
  startOrReuseOperation,
  finishOperation,
  recordModelInvocation,
  makeLogger,
  type Db,
} from '@intellilabs/core';

const log = makeLogger({ service: 'engine-worker', projectId: process.env.GCP_PROJECT_ID ?? 'local' });

const Envelope = z.object({ message: z.object({ data: z.string(), attributes: z.record(z.string(), z.string()).optional() }) });
const Payload = z.object({ offerId: z.string().min(1) });

/** A one-shot completion bound to an org: resolves a sensible default model + that org's
 *  credentials, runs ONE model call, and returns the generated text plus the model name and
 *  the USD cost so the report row can record them. (The real impl mirrors the hindsight
 *  summarizer's Vertex model; tests inject a fake.) */
export interface ReportModelClient {
  complete(orgId: string, prompt: string): Promise<{ text: string; model: string | null; costUsd: string | null; inputTokens?: number | null; outputTokens?: number | null }>;
}

/** Edits the offer's Slack message in place (best-effort; a no-op when Slack isn't configured). */
export interface ReportSlackUpdater {
  update(orgId: string, channel: string, ts: string, text: string): Promise<void>;
}

export interface ReportConsumerDeps {
  db: Db;
  model: ReportModelClient;
  slack: ReportSlackUpdater;
  /** Public base URL the report link is built on (SERVER_BASE_URL). */
  baseUrl: string;
}

export interface RunReportOpts extends FastifyPluginOptions {
  /** Verifies the Pub/Sub OIDC bearer token (real verifier in prod, fake in tests). */
  verify: (token: string) => Promise<boolean>;
  deps: ReportConsumerDeps;
}

/** Consumer for the report-gen topic. A `{ offerId }` job (published by the server when a user
 *  clicks "Generate") drives: build the investigation thread → ONE model call → standalone HTML
 *  report stored versioned → edit the Slack message to the report link → mark the offer generated.
 *  On any error: mark the offer failed + post an error note. ALWAYS acks 200 on a terminal outcome
 *  (success OR failure) — a 500 would make Pub/Sub redeliver and re-bill the model forever. */
export async function runReportRoutes(app: FastifyInstance, opts: RunReportOpts) {
  const { db, model, slack, baseUrl } = opts.deps;
  // Build the report link on the org's subdomain so it proxies /api and carries
  // the wildcard .<domain> __session cookie. Falls back to the flat base URL if
  // the org slug cannot be fetched (network/Firestore error) to avoid crashing
  // an already-stored report over a link host issue.
  const reportUrlFor = async (reportId: string, orgId: string): Promise<string> => {
    const flat = `${baseUrl.replace(/\/$/, '')}/api/reports/${reportId}`;
    try {
      const org = await getOrgById(db, orgId);
      if (org?.slug) {
        const base = new URL(baseUrl);
        return `${base.protocol}//${org.slug}.${base.host}/api/reports/${reportId}`;
      }
    } catch {
      // best-effort: fall through to flat URL
    }
    return flat;
  };

  app.post('/api/internal/run-report', async (req, reply) => {
    // 1. Authn: Pub/Sub OIDC token.
    const auth = req.headers.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
    if (!token || !(await opts.verify(token))) return reply.code(401).send({ error: 'unauthenticated' });

    // 2. Decode the push envelope → payload. Malformed → ack-drop (200).
    const env = Envelope.safeParse(req.body);
    if (!env.success) return reply.code(200).send({ dropped: true });
    let decoded: unknown;
    try { decoded = JSON.parse(Buffer.from(env.data.message.data, 'base64').toString('utf8')); }
    catch { return reply.code(200).send({ dropped: true }); }
    const parsed = Payload.safeParse(decoded);
    if (!parsed.success) return reply.code(200).send({ dropped: true });
    const { offerId } = parsed.data;

    // 3. Load + idempotency. Missing → nothing to do. Not 'generating' → already done/failed/declined
    //    (the slack click claimed it offered→generating before publishing); ack so we don't redo it.
    const offer = await getReportOffer(db, offerId);
    if (!offer) return reply.code(200).send({ dropped: 'missing' });
    if (offer.status !== 'generating') return reply.code(200).send({ dropped: 'not-generating' });

    // 4. Create a tracked operation so this job appears on the Activity page and in the
    //    RunInspector. Defensive: if this fails, log and proceed — report generation must
    //    never be blocked by telemetry. parentConversationId is null → top-level operation.
    let op: { id: string } | null = null;
    try {
      op = await startOrReuseOperation(db, {
        orgId: offer.orgId,
        projectId: offer.projectId,
        kind: 'report-gen',
        refId: offer.id,
        parentConversationId: null,
      });
    } catch (opErr) {
      log.error({ err: opErr, offerId }, 'report-gen: failed to start operation (non-fatal)');
    }

    try {
      const thread = await buildConversationThread(db, offer.conversationId);
      if (!thread) throw new Error(`conversation ${offer.conversationId} not found`);

      // The model call is ONE shot. Capture the model name + USD cost it reports so the report row
      // can record them (generateReportHtml only sees a string-in/string-out `complete`).
      let usage: { model: string | null; costUsd: string | null; inputTokens: number | null; outputTokens: number | null } = { model: null, costUsd: null, inputTokens: null, outputTokens: null };
      const complete = async (prompt: string): Promise<string> => {
        const r = await model.complete(offer.orgId, prompt);
        usage = { model: r.model, costUsd: r.costUsd, inputTokens: r.inputTokens ?? null, outputTokens: r.outputTokens ?? null };
        return r.text;
      };
      const { html } = await generateReportHtml({ complete }, { thread });

      // Record the model call as an operation-attributed invocation. conversationId is null so
      // the billing meter does NOT count this as conversation AI (incrementBillableUsage requires
      // conversationId != null) — preserves the existing billing behaviour.
      if (op) {
        await recordModelInvocation(db, {
          orgId: offer.orgId,
          source: 'report-gen',
          model: usage.model ?? 'unknown',
          operationId: op.id,
          conversationId: null,
          costUsd: usage.costUsd,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          status: 'done',
        });
      }

      const report = await createConversationReport(db, {
        conversationId: offer.conversationId, orgId: offer.orgId, projectId: offer.projectId,
        html, model: usage.model, costUsd: usage.costUsd, createdBy: null,
      });

      const url = await reportUrlFor(report.id, offer.orgId);

      // Edit the offer's "⏳ Generating report…" message into the link. Best-effort: a Slack hiccup
      // must NOT fail an already-stored report (otherwise we'd mark a stored report 'failed').
      if (offer.slackMessageTs) {
        await slack.update(
          offer.orgId, offer.slackChannelId, offer.slackMessageTs,
          `:white_check_mark: Report ready — <${url}|View report v${report.version}>`,
        ).catch((err) => { log.error({ err, offerId }, 'report ready chatUpdate failed (best-effort)'); });
      }

      // Finish the operation. Best-effort: a failure here must NOT undo an already-stored report.
      if (op) {
        await finishOperation(db, op.id, {
          status: 'done',
          costUsd: usage.costUsd,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        }).catch((opErr) => {
          log.error({ err: opErr, offerId, opId: op!.id }, 'report-gen: failed to finish operation (non-fatal)');
        });
      }

      await markReportOfferGenerated(db, offerId, { reportId: report.id, reportUrl: url, decidedBy: 'system' });
      return reply.code(200).send({ generated: report.id });
    } catch (err) {
      log.error({ err, offerId }, 'report generation failed');
      // Inner guard: if failure-recording itself throws (e.g. a transient Firestore error),
      // we must NOT let that propagate out. An unguarded throw here would make Fastify return
      // 500 → Pub/Sub redelivers → the offer is still `generating` → duplicate report.
      try {
        await markReportOfferFailed(db, offerId, { error: String(err), decidedBy: 'system' });
        if (offer.slackMessageTs) {
          await slack.update(offer.orgId, offer.slackChannelId, offer.slackMessageTs, ':warning: Report generation failed.')
            .catch(() => { /* best-effort */ });
        }
        if (op) {
          await finishOperation(db, op.id, { status: 'failed', error: String(err) });
        }
      } catch (innerErr) {
        log.error({ err: innerErr, offerId }, 'report failure-marking failed (swallowed to prevent redelivery)');
      }
      // ACK (200), never 500: redelivery would just re-run a permanently-failing generation and
      // re-bill the model. The terminal failure is recorded on the offer when possible.
      return reply.code(200).send({ failed: true });
    }
  });
}
