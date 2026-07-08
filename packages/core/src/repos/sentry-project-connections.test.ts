import { describe, it, expect } from 'vitest';
import { getProjectConnection, setProjectConnection, deleteProjectConnection } from './sentry-project-connections.js';

describe('sentry-project-connections', () => {
  it('exports its repo functions', () => {
    expect(typeof getProjectConnection).toBe('function');
    expect(typeof setProjectConnection).toBe('function');
    expect(typeof deleteProjectConnection).toBe('function');
  });
});
