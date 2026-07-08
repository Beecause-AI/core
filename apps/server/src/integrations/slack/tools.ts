import { listBindingsForProject, getIntegration, decryptSecret, keyFromBase64, markdownToBlocks, markdownToFallbackText, type Db, type SlackClient } from '@intellilabs/core';

/** Server-side catalog wire shape. Distinct from the engine's provider.ToolDef;
 *  kind:'integration' is intentional and carried over the /int tool API. */
export interface ToolDef { name: string; description: string; parameters: Record<string, unknown>; kind: 'integration'; mutates: boolean; }
/** The Slack thread that triggered the current conversation (present only on slack-sourced turns). */
export type SlackThreadContext = { channel: string; threadTs: string };
export interface SlackToolCtx { db: Db; orgId: string; projectId: string; slackClient: SlackClient; config: { SECRETS_KEY?: string }; slackThread?: SlackThreadContext; }
export interface ToolResult { content: string; isError?: boolean; }

const obj = (props: Record<string, unknown>, required: string[]) => ({ type: 'object', properties: props, required, additionalProperties: false });
const S = { type: 'string' } as const;

/** The full Slack tool catalog (used by the ToolPicker). `reply_in_thread` is only
 *  *offered to the agent* on slack-triggered turns — that runtime gating lives in the
 *  /int route, keyed off the request context. */
export function slackToolDefs(): ToolDef[] {
  const d = (name: string, description: string, parameters: Record<string, unknown>, mutates = false): ToolDef =>
    ({ name: `integration.slack.${name}`, description, parameters, kind: 'integration', mutates });
  return [
    d('post_message', 'Post a message to a channel bound to this project.', obj({ channel: S, text: S }, ['channel', 'text']), true),
    // The agent supplies only `text`; the system replies in the thread that triggered this
    // conversation. Always allowed (never gated by approval) — it's the assistant answering in
    // its own thread — so it's marked non-mutating and never appears in the write-ops policy.
    d('reply_in_thread', 'Reply in the Slack thread that triggered this conversation. Provide only the text.', obj({ text: S }, ['text']), false),
  ];
}

/** Dispatch a slack.* tool: resolve the channel/thread (post → from args, reply → from
 *  the triggering thread), enforce channel scope, decrypt the bot token, post. */
export async function callSlackTool(ctx: SlackToolCtx, name: string, rawArgs: unknown): Promise<ToolResult> {
  const args = (rawArgs ?? {}) as Record<string, unknown>;
  const bare = name.replace('integration.slack.', '');
  if (bare !== 'post_message' && bare !== 'reply_in_thread') return { content: `unknown slack tool: ${name}`, isError: true };

  const integ = await getIntegration(ctx.db, ctx.orgId, 'slack');
  if (!integ || !integ.enabled) return { content: 'slack not connected for this org', isError: true };

  const text = String(args.text ?? '');
  if (!text) return { content: 'text is required', isError: true };

  // post_message targets an agent-chosen (scoped) channel; reply_in_thread targets the
  // Slack thread that triggered this conversation — never agent-supplied.
  let channel: string;
  let threadTs: string | undefined;
  if (bare === 'reply_in_thread') {
    if (!ctx.slackThread) return { content: 'reply_in_thread is only available when the conversation was triggered from Slack', isError: true };
    channel = ctx.slackThread.channel;
    threadTs = ctx.slackThread.threadTs;
  } else {
    channel = String(args.channel ?? '');
  }

  const bindings = await listBindingsForProject(ctx.db, integ.id, ctx.projectId);
  if (!bindings.some((b) => b.slackChannelId === channel)) {
    return { content: `channel ${channel} is not in project scope`, isError: true };
  }

  if (!integ.secretCiphertext) return { content: 'slack token missing', isError: true };
  const token = decryptSecret(integ.secretCiphertext, keyFromBase64(ctx.config.SECRETS_KEY!));

  // Agents write standard Markdown (**bold**, • lists, [t](url)); Slack's text field
  // is parsed as mrkdwn, which uses single-* bold and renders ** literally. Convert to
  // Block Kit here — the same path the framework's turn delivery uses — so agent-posted
  // messages format identically. `text` becomes the plain-text notification fallback.
  const blocks = markdownToBlocks(text);
  const fallback = markdownToFallbackText(text) || text;
  try {
    const res = await ctx.slackClient.chatPostMessage(token, { channel, text: fallback, threadTs, blocks });
    if (!res.ok) return { content: `slack error: ${res.error}`, isError: true };
    return { content: JSON.stringify({ ok: true, ts: res.ts }) };
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }
}
