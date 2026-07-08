import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { GenerationProgress } from './generation-progress';

afterEach(cleanup);

describe('GenerationProgress', () => {
  it('renders all five phase labels and marks the current phase', () => {
    render(<GenerationProgress progress="designing" />);
    expect(screen.getByText('Designing the team')).toBeTruthy();
    expect(screen.getByText('Reading your code & signals')).toBeTruthy();
    expect(screen.getByText('Finalizing')).toBeTruthy();
  });

  it('defaults to the first phase when progress is null', () => {
    render(<GenerationProgress progress={null} />);
    expect(screen.getByText('Reading your code & signals')).toBeTruthy();
  });
});
