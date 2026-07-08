import { describe, expect, it } from 'vitest';
import { AZURE_SKILLS } from '../src/signals/skills/azure.js';

describe('AZURE_SKILLS', () => {
  it('declares azure-integration skills with markers', () => {
    expect(AZURE_SKILLS.length).toBeGreaterThan(0);
    expect(AZURE_SKILLS.every((s) => s.integration === 'azure')).toBe(true);
    expect(AZURE_SKILLS.some((s) => s.id === 'azure-functions')).toBe(true);
  });
});
