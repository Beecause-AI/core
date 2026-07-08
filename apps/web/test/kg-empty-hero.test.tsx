// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { KgEmptyHero } from '../src/components/project/knowledge-graph/kg-empty-hero';

afterEach(cleanup);

describe('KgEmptyHero', () => {
  test('shows value props + project name and fires onBuild', () => {
    const onBuild = vi.fn();
    render(<KgEmptyHero projectName="Acme Web" onBuild={onBuild} building={false} />);
    expect(screen.getByText('Acme Web')).toBeDefined();
    expect(screen.getByText('Blast radius')).toBeDefined();
    fireEvent.click(screen.getByText('Build knowledge graph'));
    expect(onBuild).toHaveBeenCalledOnce();
  });

  test('renders without projectName (generic copy)', () => {
    render(<KgEmptyHero onBuild={() => {}} building={false} />);
    expect(screen.getByText('Build your Knowledge Graph')).toBeDefined();
    expect(screen.getByText('Blast radius')).toBeDefined();
  });

  test('disables button while building', () => {
    render(<KgEmptyHero onBuild={() => {}} building />);
    expect((screen.getByText('Starting…') as HTMLButtonElement).disabled).toBe(true);
  });
});
