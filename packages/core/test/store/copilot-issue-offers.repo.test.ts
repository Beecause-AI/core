import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testStore, wipe } from './emulator.js';
import {
  createCopilotIssueOffer, getCopilotIssueOffer, setCopilotIssueOfferMessageTs,
  claimCopilotIssueOffer, declineCopilotIssueOffer, markCopilotIssueOfferCreated, markCopilotIssueOfferFailed,
} from '../../src/repos/copilot-issue-offers.js';

const store = testStore('copilot-offers');
const db = store.db;
const base = {
  orgId: 'org-1', projectId: 'proj-1', conversationId: 'conv-1',
  slackChannelId: 'C1', slackThreadTs: '111.1', repo: 'acme/api',
  candidateRepos: [], title: 'Fix null deref', body: 'root cause...', summary: 'Raise a fix?',
  provider: 'github' as const,
};

beforeEach(() => wipe(db));
afterAll(() => store.close());

describe('copilot-issue-offers repo', () => {
  it('creates with defaults and reads back', async () => {
    const o = await createCopilotIssueOffer(db, base);
    expect(o.id).toBeTruthy();
    expect(o.status).toBe('offered');
    expect(o.copilotAssigned).toBe(false);
    expect(o.slackMessageTs).toBeNull();
    expect(o.createdAt).toBeInstanceOf(Date);
    expect((await getCopilotIssueOffer(db, o.id))!.title).toBe('Fix null deref');
  });

  it('claim is race-safe: only the first transition out of offered wins', async () => {
    const o = await createCopilotIssueOffer(db, base);
    await setCopilotIssueOfferMessageTs(db, o.id, '222.2');
    const [a, b] = await Promise.all([claimCopilotIssueOffer(db, o.id), claimCopilotIssueOffer(db, o.id)]);
    expect([a, b].filter(Boolean).length).toBe(1);
    expect((await getCopilotIssueOffer(db, o.id))!.slackMessageTs).toBe('222.2');
  });

  it('decline only works from offered (idempotent)', async () => {
    const o = await createCopilotIssueOffer(db, base);
    expect(await declineCopilotIssueOffer(db, o.id, 'U1')).toBe(true);
    expect(await declineCopilotIssueOffer(db, o.id, 'U1')).toBe(false);
    const after = await getCopilotIssueOffer(db, o.id);
    expect(after!.status).toBe('declined');
    expect(after!.decidedBy).toBe('U1');
  });

  it('markCreated/markFailed record outcome', async () => {
    const o1 = await createCopilotIssueOffer(db, base);
    await markCopilotIssueOfferCreated(db, o1.id, { repo: 'acme/api', issueNumber: 42, issueUrl: 'https://x/42', copilotAssigned: true, error: null, decidedBy: 'U1' });
    const c = await getCopilotIssueOffer(db, o1.id);
    expect(c!.status).toBe('created'); expect(c!.issueNumber).toBe(42); expect(c!.copilotAssigned).toBe(true);

    const o2 = await createCopilotIssueOffer(db, base);
    await markCopilotIssueOfferFailed(db, o2.id, { error: 'github 403', decidedBy: 'U1' });
    expect((await getCopilotIssueOffer(db, o2.id))!.status).toBe('failed');
  });
});
