import { describe, it, expect, beforeEach } from 'vitest';
import { register, listSkills, skillsFor, type KgSkill } from '../src/index.js';
// NOTE: registry is module-global; if tests pollute, isolate via unique ids per test.
const mk = (id: string, phase: KgSkill['phase']): KgSkill => ({ id, title: id, description: '', kind: 'extractor', phase });
describe('kg-skills registry', () => {
  it('registers and lists', () => {
    register(mk('t-a', 'structure')); register(mk('t-b', 'flows'));
    const ids = listSkills().map((s) => s.id);
    expect(ids).toContain('t-a'); expect(ids).toContain('t-b');
    expect(skillsFor('flows').map((s) => s.id)).toContain('t-b');
    expect(skillsFor('flows').map((s) => s.id)).not.toContain('t-a');
  });
  it('rejects duplicate ids', () => {
    register(mk('t-dup', 'structure'));
    expect(() => register(mk('t-dup', 'structure'))).toThrow();
  });
});
