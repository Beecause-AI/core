import { describe, it, expect } from 'vitest';
import { dynatraceApiBase, dtHeaders } from '../src/index.js';

describe('dynatrace auth', () => {
  it('normalizes environmentUrl to the v2 api base (strips trailing slash)', () => {
    expect(dynatraceApiBase('https://abc.live.dynatrace.com/')).toBe('https://abc.live.dynatrace.com/api/v2');
    expect(dynatraceApiBase('https://abc.live.dynatrace.com')).toBe('https://abc.live.dynatrace.com/api/v2');
  });
  it('builds the Api-Token auth header', () => {
    const h = dtHeaders({ mode: 'api_token', environmentUrl: 'https://x', apiToken: 'dt0c01.ABC' });
    expect(h.Authorization).toBe('Api-Token dt0c01.ABC');
    expect(h['Content-Type']).toBe('application/json');
  });
});
