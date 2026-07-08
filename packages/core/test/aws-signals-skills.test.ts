import { describe, expect, it } from 'vitest';
import { AWS_SKILLS } from '../src/signals/skills/aws.js';

describe('AWS_SKILLS', () => {
  it('declares aws-integration skills with markers', () => {
    expect(AWS_SKILLS.length).toBeGreaterThan(0);
    expect(AWS_SKILLS.every((s) => s.integration === 'aws')).toBe(true);
    expect(AWS_SKILLS.some((s) => s.id === 'aws-lambda')).toBe(true);
  });
});
