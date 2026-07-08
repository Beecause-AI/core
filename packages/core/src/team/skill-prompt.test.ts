import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testStore } from '../../test/store/emulator.js';
import { createAssistant, createOrgWithOwner, createProject, createSkill, setAttachedSkills } from '../index.js';
import { renderSkillsBlock, withSkillTool } from './skill-prompt.js';

describe('renderSkillsBlock', () => {
  it('returns empty string when no skills', () => {
    expect(renderSkillsBlock([])).toBe('');
  });

  it('contains ## Skills, skill entry, and skill.load reference', () => {
    const out = renderSkillsBlock([{ name: 'a', description: 'd' }]);
    expect(out).toContain('## Skills');
    expect(out).toContain('- a: d');
    expect(out).toContain('skill.load');
  });

  it('falls back to (no description) when description is empty', () => {
    const out = renderSkillsBlock([{ name: 'b', description: '' }]);
    expect(out).toContain('- b: (no description)');
  });

  it('lists multiple skills', () => {
    const out = renderSkillsBlock([
      { name: 'alpha', description: 'first' },
      { name: 'beta', description: 'second' },
    ]);
    expect(out).toContain('- alpha: first');
    expect(out).toContain('- beta: second');
  });
});

describe('withSkillTool', () => {
  const t = testStore('skill-prompt');
  let orgId: string;
  let projectId: string;
  let assistantId: string;

  beforeAll(async () => {
    const org = await createOrgWithOwner(t.db, { name: 'SkillPromptOrg', slug: 'skill-prompt-org', userId: 'u-sp' });
    orgId = org.id;
    const proj = await createProject(t.db, org.id, { name: 'SkillPromptProj', slug: 'skill-prompt-proj' });
    projectId = proj.id;
    const asst = await createAssistant(t.db, projectId, {
      name: 'SkillPromptBot',
      persona: '',
      model: 'gemini-3-flash-preview',
      enabledTools: [],
      isLead: false,
    });
    assistantId = asst.id;
  });

  afterAll(() => t.close());

  it('returns enabledTools unchanged when no skills are attached', async () => {
    const result = await withSkillTool(t.db, assistantId, ['foo', 'bar']);
    expect(result).toEqual(['foo', 'bar']);
  });

  it('adds skill.load when at least one skill is attached', async () => {
    const skill = await createSkill(t.db, {
      orgId,
      projectId,
      name: 'sp-skill',
      description: 'A test skill',
      body: 'some body',
    });
    await setAttachedSkills(t.db, assistantId, [skill.id]);

    const result = await withSkillTool(t.db, assistantId, ['foo']);
    expect(result).toContain('skill.load');
    expect(result).toContain('foo');
  });

  it('does not duplicate skill.load if already present', async () => {
    const result = await withSkillTool(t.db, assistantId, ['foo', 'skill.load']);
    const count = result.filter((t) => t === 'skill.load').length;
    expect(count).toBe(1);

    // cleanup
    await setAttachedSkills(t.db, assistantId, []);
  });
});
