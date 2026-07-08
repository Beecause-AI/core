import type { SignalSkill } from './types.js';

const REGISTRY: SignalSkill[] = [];

export function registerSignalSkill(s: SignalSkill): void {
  if (!REGISTRY.some((x) => x.id === s.id)) REGISTRY.push(s);
}
export function listSignalSkills(): SignalSkill[] {
  return [...REGISTRY];
}
