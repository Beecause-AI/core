import { describe, it, expect } from 'vitest';
import { errorRatePromQL, latencyPromQL, logErrorFilter } from '../src/gcp/recipes.js';

describe('gcp recipes', () => {
  it('errorRatePromQL references request_count grouped by response code class', () => {
    const q = errorRatePromQL();
    expect(q).toContain('run.googleapis.com/request_count');
    expect(q.toLowerCase()).toContain('response_code_class');
  });
  it('latencyPromQL computes a high percentile', () => {
    const q = latencyPromQL(0.95);
    expect(q).toContain('0.95');
    expect(q).toContain('request_latencies');
  });
  it('logErrorFilter filters severity>=ERROR', () => {
    expect(logErrorFilter()).toContain('severity>=ERROR');
  });
});
