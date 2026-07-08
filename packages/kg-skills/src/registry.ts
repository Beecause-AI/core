import type { KgSkill, Phase } from './types.js';

const REGISTRY: KgSkill[] = [];
export function register(skill: KgSkill): void {
  if (REGISTRY.some((s) => s.id === skill.id)) throw new Error(`duplicate kg skill id: ${skill.id}`);
  REGISTRY.push(skill);
}
export function listSkills(): KgSkill[] { return [...REGISTRY]; }
export function skillsFor(phase: Phase): KgSkill[] { return REGISTRY.filter((s) => s.phase === phase); }
