import { describe, it, expect } from 'vitest';
import { renderKgSummary } from './kg-summary.js';

describe('renderKgSummary', () => {
  it('renders flows with their implementing components', () => {
    const text = renderKgSummary(
      [{ id: 'f1', name: 'Checkout', businessFlow: 'User pays', digest: null } as any],
      { f1: [{ id: 'c1', name: 'PaymentService', digest: 'charges cards' } as any] },
    );
    // Format matters — this text feeds an LLM prompt.
    expect(text).toContain('Flow: Checkout');
    expect(text).toContain('Purpose: User pays');
    expect(text).toContain('- PaymentService: charges cards');
  });

  it('omits the Purpose line and renders the no-components marker when data is sparse', () => {
    const text = renderKgSummary([{ id: 'f1', name: 'Solo', businessFlow: null, digest: null } as any], {});
    expect(text).not.toContain('Purpose:');
    expect(text).toContain('(no components mapped)');
  });

  it('returns an empty marker when there are no flows', () => {
    expect(renderKgSummary([], {})).toContain('(no business flows');
  });
});
