import { describe, expect, it } from 'vitest';
import { makeSlackClientForTest } from '../src/slack/client.js';

type Json = Record<string, unknown>;
const fetchReturning = (body: Json) =>
  (async () => ({ ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body })) as any;

describe('slack client — oauthAccess', () => {
  it('maps a successful oauth.v2.access response', async () => {
    const client = makeSlackClientForTest(fetchReturning({
      ok: true, access_token: 'xoxb-123', bot_user_id: 'U999', scope: 'app_mentions:read,chat:write',
      team: { id: 'T1', name: 'Acme HQ' },
    }));
    const res = await client.oauthAccess({ code: 'c', clientId: 'id', clientSecret: 'sec', redirectUri: 'https://x/cb' });
    expect(res).toEqual({ ok: true, botToken: 'xoxb-123', teamId: 'T1', teamName: 'Acme HQ', botUserId: 'U999', scope: 'app_mentions:read,chat:write' });
  });

  it('returns ok:false with the Slack error code', async () => {
    const client = makeSlackClientForTest(fetchReturning({ ok: false, error: 'invalid_code' }));
    const res = await client.oauthAccess({ code: 'bad', clientId: 'id', clientSecret: 'sec', redirectUri: 'https://x/cb' });
    expect(res).toEqual({ ok: false, error: 'invalid_code' });
  });
});

describe('slack client — authTest', () => {
  it('maps a successful auth.test response', async () => {
    const client = makeSlackClientForTest(fetchReturning({ ok: true, team: 'Acme HQ', team_id: 'T1', user_id: 'U999' }));
    const res = await client.authTest('xoxb-123');
    expect(res).toEqual({ ok: true, teamId: 'T1', teamName: 'Acme HQ', botUserId: 'U999' });
  });

  it('returns ok:false with the Slack error code', async () => {
    const client = makeSlackClientForTest(fetchReturning({ ok: false, error: 'invalid_auth' }));
    const res = await client.authTest('bad');
    expect(res).toEqual({ ok: false, error: 'invalid_auth' });
  });
});

describe('slack client — chat', () => {
  it('chatPostMessage returns the ts on success', async () => {
    const client = makeSlackClientForTest(fetchReturning({ ok: true, ts: '1700.0001' }));
    const res = await client.chatPostMessage('xoxb-1', { channel: 'C1', threadTs: '111.1', text: 'hi' });
    expect(res).toEqual({ ok: true, ts: '1700.0001' });
  });
  it('chatPostMessage serializes blocks into the request body', async () => {
    let sentBody = '';
    const fetchSpy = (async (_url: string, init?: any) => {
      sentBody = String(init?.body ?? '');
      return { ok: true, status: 200, text: async () => '{}', json: async () => ({ ok: true, ts: '1.0' }) };
    }) as any;
    const client = makeSlackClientForTest(fetchSpy);
    const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: 'hi' } }];
    await client.chatPostMessage('xoxb-1', { channel: 'C1', text: 'fallback', blocks });
    const params = new URLSearchParams(sentBody);
    expect(params.get('text')).toBe('fallback');
    expect(JSON.parse(params.get('blocks') ?? '[]')).toEqual(blocks);
  });
  it('chatUpdate surfaces the error code', async () => {
    const client = makeSlackClientForTest(fetchReturning({ ok: false, error: 'message_not_found' }));
    const res = await client.chatUpdate('xoxb-1', { channel: 'C1', ts: '1700.0001', text: 'edited' });
    expect(res).toEqual({ ok: false, error: 'message_not_found' });
  });
  it('chatUpdate serializes blocks into the request body', async () => {
    let sentBody = '';
    const fetchSpy = (async (_url: string, init?: any) => {
      sentBody = String(init?.body ?? '');
      return { ok: true, status: 200, text: async () => '{}', json: async () => ({ ok: true, ts: '1.0' }) };
    }) as any;
    const client = makeSlackClientForTest(fetchSpy);
    const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: 'hi' } }];
    await client.chatUpdate('xoxb-1', { channel: 'C1', ts: '123', text: 'hi', blocks });
    const params = new URLSearchParams(sentBody);
    expect(params.get('channel')).toBe('C1');
    expect(params.get('ts')).toBe('123');
    expect(params.get('text')).toBe('hi');
    expect(JSON.parse(params.get('blocks') ?? '[]')).toEqual(blocks);
  });
  it('chatUpdate without blocks omits the blocks field', async () => {
    let sentBody = '';
    const fetchSpy = (async (_url: string, init?: any) => {
      sentBody = String(init?.body ?? '');
      return { ok: true, status: 200, text: async () => '{}', json: async () => ({ ok: true, ts: '1.0' }) };
    }) as any;
    const client = makeSlackClientForTest(fetchSpy);
    await client.chatUpdate('xoxb-1', { channel: 'C1', ts: '123', text: 'hi' });
    const params = new URLSearchParams(sentBody);
    expect(params.get('blocks')).toBeNull();
  });
});
