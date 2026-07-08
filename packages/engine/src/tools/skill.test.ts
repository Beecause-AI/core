import { describe, it, expect } from 'vitest';
import { SkillToolExecutor, type SkillClient } from './skill.js';

const client: SkillClient = {
  load: async (_p, _a, name) => (name === 'rollback' ? 'ROLLBACK BODY' : null),
};

describe('SkillToolExecutor', () => {
  it('exposes skill.load only when enabled + project/assistant present', () => {
    const ok = new SkillToolExecutor(client, 'p', 'a');
    expect(ok.toToolDefs(['skill.load']).map((d) => d.name)).toEqual(['skill.load']);
    expect(ok.toToolDefs([]).length).toBe(0);
    expect(new SkillToolExecutor(client, undefined, undefined).toToolDefs(['skill.load']).length).toBe(0);
  });

  it('returns the body for an attached skill', async () => {
    const ex = new SkillToolExecutor(client, 'p', 'a');
    const res = await ex.execute({ id: '1', name: 'skill.load', arguments: { name: 'rollback' } }, new AbortController().signal);
    expect(res.isError).toBe(false);
    expect(res.content).toBe('ROLLBACK BODY');
  });

  it('returns a not-found message (not an error abort) for an unattached skill', async () => {
    const ex = new SkillToolExecutor(client, 'p', 'a');
    const res = await ex.execute({ id: '1', name: 'skill.load', arguments: { name: 'nope' } }, new AbortController().signal);
    expect(res.isError).toBe(false);
    expect(res.content).toContain('no skill');
  });
});
