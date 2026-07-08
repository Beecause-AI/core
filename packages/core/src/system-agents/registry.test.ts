import { describe, it, expect } from 'vitest';
import { getSystemAgent, listSystemAgents } from './registry.js';

describe('system-agents registry', () => {
  it('returns null for hindsight (removed) and null for unknown', () => {
    expect(getSystemAgent('hindsight')).toBeNull();
    expect(getSystemAgent('nope')).toBeNull();
  });
  it('returns the slack config', () => {
    const s = getSystemAgent('slack');
    expect(s?.name).toBe('Slack Intake');
    expect(s?.model).toBe('gemini-3-flash-preview');
    // No Slack-posting tools: the agent's response is auto-delivered to the thread (posting via
    // tools caused duplicate/out-of-order messages).
    expect(s?.tools).toEqual([]);
    expect(s?.persona).toMatch(/orchestrator/i);
  });
  it('lists system agents (only slack; hindsight removed)', () => {
    const keys = listSystemAgents().map((s) => s.key);
    expect(keys).not.toContain('hindsight');
    expect(keys).toContain('slack');
  });
  it('resolves analysis-fleet keys via fallback (but not in general exposure)', () => {
    expect(getSystemAgent('analysis.orchestrator')!.tools).toContain('team.submit_proposal');
    expect(getSystemAgent('analysis.code')!.name).toBe('Code Analyst');
    expect(listSystemAgents().map((s) => s.key)).not.toContain('analysis.orchestrator');
  });
});
