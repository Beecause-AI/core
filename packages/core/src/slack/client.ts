type FetchImpl = (url: string, init?: any) => Promise<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<any> }>;

export type SlackOauthInput = { code: string; clientId: string; clientSecret: string; redirectUri: string };
export type SlackOauthResult =
  | { ok: true; botToken: string; teamId: string; teamName: string; botUserId: string; scope: string }
  | { ok: false; error: string };
export type SlackAuthTestResult =
  | { ok: true; teamId: string; teamName: string; botUserId: string }
  | { ok: false; error: string };
export type SlackChatResult = { ok: true; ts?: string } | { ok: false; error: string };

export interface SlackClient {
  oauthAccess(input: SlackOauthInput): Promise<SlackOauthResult>;
  authTest(token: string): Promise<SlackAuthTestResult>;
  chatPostMessage(token: string, input: { channel: string; threadTs?: string; text: string; blocks?: unknown[] }): Promise<SlackChatResult>;
  chatUpdate(token: string, input: { channel: string; ts: string; text: string; blocks?: unknown[] }): Promise<SlackChatResult>;
}

const SLACK_API = 'https://slack.com/api';

function makeClient(fetchImpl: FetchImpl): SlackClient {
  return {
    async oauthAccess({ code, clientId, clientSecret, redirectUri }) {
      try {
        const body = new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri });
        const res = await fetchImpl(`${SLACK_API}/oauth.v2.access`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });
        const j = await res.json();
        if (!j?.ok) return { ok: false, error: String(j?.error ?? `http_${res.status}`) };
        return {
          ok: true,
          botToken: String(j.access_token),
          teamId: String(j.team?.id ?? ''),
          teamName: String(j.team?.name ?? ''),
          botUserId: String(j.bot_user_id ?? ''),
          scope: String(j.scope ?? ''),
        };
      } catch {
        return { ok: false, error: 'unreachable' };
      }
    },

    async authTest(token) {
      try {
        const res = await fetchImpl(`${SLACK_API}/auth.test`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        });
        const j = await res.json();
        if (!j?.ok) return { ok: false, error: String(j?.error ?? `http_${res.status}`) };
        return { ok: true, teamId: String(j.team_id ?? ''), teamName: String(j.team ?? ''), botUserId: String(j.user_id ?? '') };
      } catch {
        return { ok: false, error: 'unreachable' };
      }
    },

    async chatPostMessage(token, { channel, threadTs, text, blocks }) {
      try {
        const body = new URLSearchParams({
          channel, text,
          ...(threadTs ? { thread_ts: threadTs } : {}),
          ...(blocks ? { blocks: JSON.stringify(blocks) } : {}),
        });
        const res = await fetchImpl(`${SLACK_API}/chat.postMessage`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });
        const j = await res.json();
        if (!j?.ok) return { ok: false, error: String(j?.error ?? `http_${res.status}`) };
        return { ok: true, ts: j.ts ? String(j.ts) : undefined };
      } catch { return { ok: false, error: 'unreachable' }; }
    },

    async chatUpdate(token, { channel, ts, text, blocks }) {
      try {
        const body = new URLSearchParams({
          channel, ts, text,
          ...(blocks ? { blocks: JSON.stringify(blocks) } : {}),
        });
        const res = await fetchImpl(`${SLACK_API}/chat.update`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });
        const j = await res.json();
        if (!j?.ok) return { ok: false, error: String(j?.error ?? `http_${res.status}`) };
        return { ok: true, ts: j.ts ? String(j.ts) : undefined };
      } catch { return { ok: false, error: 'unreachable' }; }
    },
  };
}

export const realSlackClient: SlackClient = makeClient(globalThis.fetch as unknown as FetchImpl);
export const makeSlackClientForTest = (fetchImpl: FetchImpl): SlackClient => makeClient(fetchImpl);
