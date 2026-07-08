// @vitest-environment jsdom
import { cleanup, render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { KgBuilding } from '../src/components/project/knowledge-graph/kg-building';
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('KgBuilding', () => {
  test('renders all 5 phases and advances the elapsed timer', () => {
    render(<KgBuilding phase="structure" />);
    expect(screen.getByText('Reading repository structure')).toBeDefined();
    expect(screen.getByText('Analyzing architecture')).toBeDefined();
    expect(screen.getByText('Naming business flows')).toBeDefined();
    expect(screen.getByText('Resolving dependencies')).toBeDefined();
    expect(screen.getByText('Finalizing')).toBeDefined();
    act(() => { vi.advanceTimersByTime(25_000); });
    expect(screen.getByText(/elapsed 0:25/)).toBeDefined();
  });

  test('marks phases before the active one as done', () => {
    // With phase='flows' (index 2), phases 0+1 should be done, 2 active, 3+4 pending.
    const { container } = render(<KgBuilding phase="flows" />);
    const dots = container.querySelectorAll('li span:first-child');
    // done = bg-ok (indices 0, 1)
    expect(dots[0].className).toContain('bg-ok');
    expect(dots[1].className).toContain('bg-ok');
    // active = bg-accent animate-pulse (index 2)
    expect(dots[2].className).toContain('bg-accent');
    expect(dots[2].className).toContain('animate-pulse');
    // pending = bg-edge-strong (indices 3, 4)
    expect(dots[3].className).toContain('bg-edge-strong');
    expect(dots[4].className).toContain('bg-edge-strong');
  });

  test('defaults to structure phase when phase is null', () => {
    const { container } = render(<KgBuilding phase={null} />);
    const dots = container.querySelectorAll('li span:first-child');
    // No done phases — first dot is active
    expect(dots[0].className).toContain('bg-accent');
    expect(dots[0].className).toContain('animate-pulse');
    expect(dots[1].className).toContain('bg-edge-strong');
  });
});
