import { describe, it, expect } from 'vitest';
import { makeTeamsClientForTest, type TeamsAuth } from '../src/teams/client.js';

const auth: TeamsAuth = { appId: 'app', appPassword: 'pw', tenantId: 'tid' };

function recordingFactory() {
  const calls: any[] = [];
  const factory = (_auth: TeamsAuth, serviceUrl: string) => ({
    conversations: {
      async sendToConversation(conversationId: string, activity: any) { calls.push({ op: 'send', serviceUrl, conversationId, activity }); return { id: 'a-new' }; },
      async replyToActivity(conversationId: string, activityId: string, activity: any) { calls.push({ op: 'reply', serviceUrl, conversationId, activityId, activity }); return { id: 'a-reply' }; },
      async updateActivity(conversationId: string, activityId: string, activity: any) { calls.push({ op: 'update', serviceUrl, conversationId, activityId, activity }); return { id: activityId }; },
    },
  });
  return { factory, calls };
}

describe('TeamsClient', () => {
  it('sendActivity posts a markdown message and returns the new activity id', async () => {
    const { factory, calls } = recordingFactory();
    const client = makeTeamsClientForTest(factory);
    const res = await client.sendActivity(auth, { serviceUrl: 'https://smba.example/', conversationId: '19:abc', text: '**hi**' });
    expect(res).toEqual({ ok: true, activityId: 'a-new' });
    expect(calls[0].op).toBe('send');
    expect(calls[0].activity).toMatchObject({ type: 'message', text: '**hi**', textFormat: 'markdown' });
  });

  it('sendActivity with replyToId replies in-thread', async () => {
    const { factory, calls } = recordingFactory();
    const client = makeTeamsClientForTest(factory);
    const res = await client.sendActivity(auth, { serviceUrl: 'https://smba.example/', conversationId: '19:abc', text: 'x', replyToId: 'root-1' });
    expect(res.ok).toBe(true);
    expect(calls[0]).toMatchObject({ op: 'reply', activityId: 'root-1' });
  });

  it('updateActivity edits an existing activity', async () => {
    const { factory, calls } = recordingFactory();
    const client = makeTeamsClientForTest(factory);
    const res = await client.updateActivity(auth, { serviceUrl: 'https://smba.example/', conversationId: '19:abc', activityId: 'ph-1', text: 'final' });
    expect(res).toEqual({ ok: true, activityId: 'ph-1' });
    expect(calls[0]).toMatchObject({ op: 'update', activityId: 'ph-1' });
  });

  it('returns { ok:false } when the connector throws', async () => {
    const client = makeTeamsClientForTest(() => ({ conversations: {
      async sendToConversation() { throw new Error('boom'); },
      async replyToActivity() { throw new Error('boom'); },
      async updateActivity() { throw new Error('boom'); },
    } }));
    const res = await client.sendActivity(auth, { serviceUrl: 's', conversationId: 'c', text: 't' });
    expect(res.ok).toBe(false);
  });
});
