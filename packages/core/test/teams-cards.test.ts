import { describe, it, expect } from 'vitest';
import { connectCardAttachment, teamsReplyText } from '../src/teams/cards.js';

describe('connectCardAttachment', () => {
  it('builds an adaptive card with an OpenUrl action to the connect url', () => {
    const att = connectCardAttachment('https://acme.beecause.ai/teams/connect?tenant=t&conversation=c&serviceUrl=s') as any;
    expect(att.contentType).toBe('application/vnd.microsoft.card.adaptive');
    const action = att.content.actions[0];
    expect(action.type).toBe('Action.OpenUrl');
    expect(action.url).toContain('/teams/connect?tenant=t');
  });
});

describe('teamsReplyText', () => {
  it('trims and falls back when empty', () => {
    expect(teamsReplyText('  hi  ')).toBe('hi');
    expect(teamsReplyText('   ')).toBe('(no response)');
  });
});
