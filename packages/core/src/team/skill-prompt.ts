import type { Db } from '../db/client.js';
import { listAttachedSkills } from '../repos/agent-skills.js';

/** Compose the Skills block from an assistant's attached skills (name + one-line description).
 *  Returns '' when none are attached. */
export function renderSkillsBlock(skills: { name: string; description: string }[]): string {
  if (skills.length === 0) return '';
  const lines = skills.map((s) => `- ${s.name}: ${s.description || '(no description)'}`).join('\n');
  return `## Skills\n\nYou have these skills available. Call \`skill.load(name)\` to read a skill's full instructions before applying it.\n\n${lines}\n`;
}

/** enabledTools plus 'skill.load' iff the assistant has >=1 attached skill. */
export async function withSkillTool(db: Db, assistantId: string, enabledTools: string[]): Promise<string[]> {
  const has = (await listAttachedSkills(db, assistantId)).length > 0;
  return has && !enabledTools.includes('skill.load') ? [...enabledTools, 'skill.load'] : enabledTools;
}
