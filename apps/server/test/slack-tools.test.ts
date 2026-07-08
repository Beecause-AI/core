import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrgWithOwner, createProject, upsertIntegration, getIntegration, setBinding, encryptSecret } from '@intellilabs/core';
import { slackToolDefs, callSlackTool, type SlackToolCtx } from '../src/integrations/slack/tools.js';
import { startTestDb, testConfig } from './helpers.js';

const calls: any[] = [];
const slackClient = {
  chatPostMessage: async (_token: string, input: any) => { calls.push(input); return { ok: true as const, ts: '123.45' }; },
} as any;

let t: Awaited<ReturnType<typeof startTestDb>>;
let ctx: SlackToolCtx;

beforeAll(async () => {
  t = await startTestDb();
  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme-sl', userId: 'u1' });
  const proj = await createProject(t.db, org.id, { name: 'Web', slug: 'web-sl' });

  const secretsKey = Buffer.alloc(32, 1);
  await upsertIntegration(t.db, {
    orgId: org.id, provider: 'slack', mode: 'oauth',
    secretCiphertext: encryptSecret('xoxb-dummy', secretsKey), connectedByUserId: 'u1', metadata: {},
  });
  const intg = (await getIntegration(t.db, org.id, 'slack'))!;

  await setBinding(t.db, { orgIntegrationId: intg.id, slackChannelId: 'C123', projectId: proj.id, createdByUserId: 'u1' });

  ctx = {
    db: t.db, orgId: org.id, projectId: proj.id, slackClient,
    config: { ...testConfig, SECRETS_KEY: Buffer.alloc(32, 1).toString('base64') },
  };
});

afterAll(async () => { await t.stop(); });

describe('slack tools', () => {
  it('exposes namespaced defs; post_message writes, reply_in_thread is always-allowed (non-mutating) and takes only text', () => {
    const defs = slackToolDefs();
    expect(defs.find((d) => d.name === 'integration.slack.post_message')!.mutates).toBe(true);
    const reply = defs.find((d) => d.name === 'integration.slack.reply_in_thread')!;
    expect(reply.mutates).toBe(false);
    expect((reply.parameters as any).required).toEqual(['text']);
  });

  it('posts to a bound channel and enforces channel scope', async () => {
    const ok = await callSlackTool(ctx, 'integration.slack.post_message', { channel: 'C123', text: 'hi' });
    expect(ok.isError).toBeFalsy();
    expect(ok.content).toContain('"ok":true');
    expect(calls.at(-1)).toMatchObject({ channel: 'C123', text: 'hi' });

    const denied = await callSlackTool(ctx, 'integration.slack.post_message', { channel: 'C999', text: 'x' });
    expect(denied.isError).toBe(true);
    expect(denied.content).toContain('not in project scope');
  });

  it('converts agent Markdown to Block Kit mrkdwn (** -> *) so it renders, with a plain-text fallback', async () => {
    const ok = await callSlackTool(ctx, 'integration.slack.post_message', { channel: 'C123', text: '**Root Cause**' });
    expect(ok.isError).toBeFalsy();
    const sent = calls.at(-1);
    // Block Kit carries the rich content: ** becomes single-* Slack mrkdwn bold.
    expect(sent.blocks[0].text.text).toBe('*Root Cause*');
    expect(sent.blocks[0].text.type).toBe('mrkdwn');
    // The `text` field is the notification fallback — markdown stripped, no literal **.
    expect(sent.text).toBe('Root Cause');
  });

  it('reply_in_thread replies in the triggering thread from context (agent passes only text)', async () => {
    const replyCtx = { ...ctx, slackThread: { channel: 'C123', threadTs: '111.22' } };
    const ok = await callSlackTool(replyCtx, 'integration.slack.reply_in_thread', { text: 'yo' });
    expect(ok.isError).toBeFalsy();
    expect(calls.at(-1)).toMatchObject({ channel: 'C123', text: 'yo', threadTs: '111.22' });
  });

  it('reply_in_thread is unavailable without a Slack thread context', async () => {
    const r = await callSlackTool(ctx, 'integration.slack.reply_in_thread', { text: 'yo' });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('only available when the conversation was triggered from Slack');
  });

  it('requires text', async () => {
    const r = await callSlackTool(ctx, 'integration.slack.post_message', { channel: 'C123' });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('text is required');
  });
});
