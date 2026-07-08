import { describe, it, expect } from 'vitest';
import { parseActivity, stripMention } from '../src/teams/activity.js';

const BOT = '28:bot-app-id';

const sample = {
  type: 'message',
  id: 'act-123',
  serviceUrl: 'https://smba.trafficmanager.net/emea/',
  text: '<at>Beecause</at> are we seeing 500s?',
  from: { id: '29:user-aad' },
  conversation: { id: '19:channelthread@thread.tacv2', tenantId: 'tenant-from-convo' },
  channelData: { tenant: { id: 'tenant-from-channeldata' } },
  entities: [{ type: 'mention', mentioned: { id: BOT } }],
};

describe('parseActivity', () => {
  it('extracts tenant (channelData wins), serviceUrl, conversation, ids and mention flag', () => {
    const p = parseActivity(sample, BOT);
    expect(p.tenantId).toBe('tenant-from-channeldata');
    expect(p.serviceUrl).toBe('https://smba.trafficmanager.net/emea/');
    expect(p.conversationId).toBe('19:channelthread@thread.tacv2');
    expect(p.activityId).toBe('act-123');
    expect(p.fromId).toBe('29:user-aad');
    expect(p.isBotMentioned).toBe(true);
  });

  it('falls back to conversation.tenantId when channelData is absent', () => {
    const p = parseActivity({ ...sample, channelData: undefined }, BOT);
    expect(p.tenantId).toBe('tenant-from-convo');
  });

  it('is not mentioned when no mention entity targets the bot', () => {
    const p = parseActivity({ ...sample, entities: [{ type: 'mention', mentioned: { id: '28:someone-else' } }] }, BOT);
    expect(p.isBotMentioned).toBe(false);
  });
});

describe('stripMention', () => {
  it('removes <at>…</at> tags and collapses whitespace', () => {
    expect(stripMention('<at>Beecause</at>   are we seeing 500s?')).toBe('are we seeing 500s?');
  });
});
