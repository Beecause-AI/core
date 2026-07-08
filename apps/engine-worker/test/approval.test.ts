import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { QueuedTurn } from '@intellilabs/core';

// ─── Mock @intellilabs/core before importing the module under test ───────────
// Using importOriginal to keep the real helpers like decryptSecret while
// stubbing the async DB calls.
const mockGetOrgApprovalPolicy = vi.fn();
const mockGetProjectApprovalPolicy = vi.fn();
const mockCreateAgentRun = vi.fn();
const mockGetIntegration = vi.fn();
const mockDecryptSecret = vi.fn();

vi.mock('@intellilabs/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@intellilabs/core')>();
  return {
    ...real,
    getOrgApprovalPolicy: (...args: unknown[]) => mockGetOrgApprovalPolicy(...args),
    getProjectApprovalPolicy: (...args: unknown[]) => mockGetProjectApprovalPolicy(...args),
    createAgentRun: (...args: unknown[]) => mockCreateAgentRun(...args),
    getIntegration: (...args: unknown[]) => mockGetIntegration(...args),
    decryptSecret: (...args: unknown[]) => mockDecryptSecret(...args),
  };
});

// Import AFTER vi.mock so the mock is in place.
import { makeApproval, makeOnSuspend } from '../src/engine/approval.js';

// ─── Helpers ────────────────────────────────────────────────────────────────
function makeTurn(overrides: Partial<QueuedTurn['payload']> & { id?: string; orgId?: string; laneId?: string } = {}): QueuedTurn {
  const { id = 'turn-1', orgId = 'org-1', laneId = 'lane-1', ...payload } = overrides;
  return {
    id,
    laneId,
    orgId,
    source: 'slack',
    attempts: 0,
    payload: {
      model: 'test-model',
      enabledTools: ['mcp.write'],
      slack: { channel: 'C1', threadTs: '1.1', placeholderTs: 'ph.1' },
      ...payload,
    },
  } as unknown as QueuedTurn;
}

const fakeDb = {} as any;

beforeEach(() => {
  vi.resetAllMocks();
});

// ─── makeApproval ────────────────────────────────────────────────────────────
describe('makeApproval', () => {
  it('passes decision from payload through to the ApprovalContext', async () => {
    mockGetOrgApprovalPolicy.mockResolvedValue(null);
    mockGetProjectApprovalPolicy.mockResolvedValue(null);

    const factory = makeApproval(fakeDb);
    const turn = makeTurn({ decision: 'approved' } as any);
    const ctx = await factory(turn);

    expect(ctx.decision).toBe('approved');
  });

  it('with no policies the system default allows mutating tools (no approval)', async () => {
    mockGetOrgApprovalPolicy.mockResolvedValue(null);
    // No projectId in payload → getProjectApprovalPolicy is never called.
    const factory = makeApproval(fakeDb);
    const turn = makeTurn(); // no projectId
    const ctx = await factory(turn);

    expect(ctx.required('mcp.write', true)).toBe(false);   // default: writes are NOT gated
    expect(ctx.required('builtin.add', false)).toBe(false); // read → not gated
    expect(mockGetProjectApprovalPolicy).not.toHaveBeenCalled();
  });

  it('with writeToolsRequireApproval:false on org policy, mutating tools are not gated', async () => {
    mockGetOrgApprovalPolicy.mockResolvedValue({ writeToolsRequireApproval: false });
    const factory = makeApproval(fakeDb);
    const turn = makeTurn({ projectId: 'proj-1' } as any);
    const ctx = await factory(turn);

    expect(ctx.required('mcp.write', true)).toBe(false); // org policy disables gate
  });

  it('falls back to project policy when org policy is null', async () => {
    mockGetOrgApprovalPolicy.mockResolvedValue(null);
    mockGetProjectApprovalPolicy.mockResolvedValue({ writeToolsRequireApproval: false });
    const factory = makeApproval(fakeDb);
    const turn = makeTurn({ projectId: 'proj-1' } as any);
    const ctx = await factory(turn);

    expect(ctx.required('mcp.write', true)).toBe(false); // project policy takes effect
  });

  it('queries getProjectApprovalPolicy only when projectId is present', async () => {
    mockGetOrgApprovalPolicy.mockResolvedValue(null);
    mockGetProjectApprovalPolicy.mockResolvedValue(null);
    const factory = makeApproval(fakeDb);

    // Without projectId
    await factory(makeTurn());
    expect(mockGetProjectApprovalPolicy).not.toHaveBeenCalled();

    // With projectId
    await factory(makeTurn({ projectId: 'proj-42' } as any));
    expect(mockGetProjectApprovalPolicy).toHaveBeenCalledWith(fakeDb, 'proj-42');
  });

  it('decision is undefined on a first-run turn (no decision in payload)', async () => {
    mockGetOrgApprovalPolicy.mockResolvedValue(null);
    const factory = makeApproval(fakeDb);
    const ctx = await factory(makeTurn());
    expect(ctx.decision).toBeUndefined();
  });
});

// ─── makeOnSuspend ───────────────────────────────────────────────────────────
describe('makeOnSuspend', () => {
  const secretsKeyBuf = Buffer.alloc(32, 2);
  const chatUpdateSpy = vi.fn().mockResolvedValue({ ok: true });
  const fakeDeps = {
    db: fakeDb,
    secretsKey: () => secretsKeyBuf,
    client: {
      chatUpdate: chatUpdateSpy,
    } as any,
  };

  beforeEach(() => {
    chatUpdateSpy.mockReset();
    chatUpdateSpy.mockResolvedValue({ ok: true });
  });

  it('calls createAgentRun with turn and data, then posts Approve/Deny buttons to Slack', async () => {
    mockCreateAgentRun.mockResolvedValue({ id: 'run-1' });
    mockGetIntegration.mockResolvedValue({ secretCiphertext: 'enc-token' });
    mockDecryptSecret.mockReturnValue('xoxb-bot-token');

    const onSuspend = makeOnSuspend(fakeDeps);
    const turn = makeTurn();
    const messages = [{ role: 'user', content: 'do write' }];
    const calls = [{ id: 'call-1', name: 'mcp.write' }];

    await onSuspend(turn, { messages, calls });

    // createAgentRun received correct args
    expect(mockCreateAgentRun).toHaveBeenCalledOnce();
    const [_db, runInput] = mockCreateAgentRun.mock.calls[0]!;
    expect(runInput).toMatchObject({
      turnId: 'turn-1',
      laneId: 'lane-1',
      orgId: 'org-1',
      messages,
      pendingCalls: calls,
      model: 'test-model',
      enabledTools: ['mcp.write'],
    });

    // chatUpdate was called once with the approve/deny buttons
    expect(chatUpdateSpy).toHaveBeenCalledOnce();
    const [token, update] = chatUpdateSpy.mock.calls[0]!;
    expect(token).toBe('xoxb-bot-token');
    expect(update.channel).toBe('C1');
    expect(update.ts).toBe('ph.1');
    expect(update.text).toContain('mcp.write');

    // Blocks contain two buttons with run-id values
    const actionsBlock = update.blocks?.find((b: any) => b.type === 'actions');
    expect(actionsBlock).toBeDefined();
    const values = actionsBlock.elements.map((e: any) => e.value);
    expect(values).toContain('run-1:approve');
    expect(values).toContain('run-1:deny');
  });

  it('persists agent_run but skips chatUpdate when turn has no slack payload', async () => {
    mockCreateAgentRun.mockResolvedValue({ id: 'run-2' });

    const onSuspend = makeOnSuspend(fakeDeps);
    // Turn without slack field
    const turn = {
      id: 'turn-2',
      laneId: 'lane-2',
      orgId: 'org-1',
      source: 'web',
      attempts: 0,
      payload: { model: 'test-model', enabledTools: [] },
    } as unknown as QueuedTurn;

    await onSuspend(turn, { messages: [], calls: [{ id: 'c1', name: 'fn' }] });

    expect(mockCreateAgentRun).toHaveBeenCalledOnce();
    expect(chatUpdateSpy).not.toHaveBeenCalled();
    expect(mockGetIntegration).not.toHaveBeenCalled();
  });

  it('skips chatUpdate when no Slack integration is found', async () => {
    mockCreateAgentRun.mockResolvedValue({ id: 'run-3' });
    mockGetIntegration.mockResolvedValue(null); // no integration

    const onSuspend = makeOnSuspend(fakeDeps);
    await onSuspend(makeTurn(), { messages: [], calls: [{ id: 'c1', name: 'fn' }] });

    expect(mockCreateAgentRun).toHaveBeenCalledOnce();
    expect(chatUpdateSpy).not.toHaveBeenCalled();
  });

  it('includes all pending call names in the approval message text', async () => {
    mockCreateAgentRun.mockResolvedValue({ id: 'run-4' });
    mockGetIntegration.mockResolvedValue({ secretCiphertext: 'enc' });
    mockDecryptSecret.mockReturnValue('tok');

    const onSuspend = makeOnSuspend(fakeDeps);
    const calls = [
      { id: 'c1', name: 'mcp.write' },
      { id: 'c2', name: 'mcp.delete' },
    ];
    await onSuspend(makeTurn(), { messages: [], calls });

    const [, update] = chatUpdateSpy.mock.calls[0]!;
    expect(update.text).toContain('mcp.write');
    expect(update.text).toContain('mcp.delete');
    const sectionBlock = update.blocks?.find((b: any) => b.type === 'section');
    expect(sectionBlock?.text?.text).toContain('mcp.write, mcp.delete');
  });
});
