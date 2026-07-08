// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { KgFlowsGrid } from '../src/components/project/knowledge-graph/kg-flows-grid';

afterEach(cleanup);

const flows = [
  { id: 'f1', name: 'Checkout', digest: 'Handles checkout.' },
  { id: 'f2', name: 'Auth', digest: null },
];

describe('KgFlowsGrid', () => {
  test('renders flow cards and fires actions', () => {
    const onRebuild = vi.fn();
    const onOpenExplore = vi.fn();
    render(
      <KgFlowsGrid
        flows={flows}
        note={null}
        onRebuild={onRebuild}
        rebuilding={false}
        onOpenExplore={onOpenExplore}
      />,
    );
    expect(screen.getByText('Checkout')).toBeDefined();
    expect(screen.getByText('Handles checkout.')).toBeDefined();
    expect(screen.queryByText(/Rebuild to generate/)).toBeNull();
    fireEvent.click(screen.getByText('Explore graph'));
    expect(onOpenExplore).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText('Rebuild'));
    expect(onRebuild).toHaveBeenCalledOnce();
  });

  test('shows partial banner and disables rebuild while rebuilding', () => {
    render(
      <KgFlowsGrid
        flows={[]}
        note="partial: semantic pass failed"
        onRebuild={() => {}}
        rebuilding
        onOpenExplore={() => {}}
      />,
    );
    expect(screen.getByText(/Structure mapped/)).toBeDefined();
    expect(screen.getByText('No business flows yet.')).toBeDefined();
    expect((screen.getByText('Starting…') as HTMLButtonElement).disabled).toBe(true);
  });
});
