// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { Stepper } from '../src/components/ui/stepper';

afterEach(() => cleanup());

describe('Stepper', () => {
  test('renders each step label and marks the current one', () => {
    render(<Stepper steps={['Choose', 'Configure', 'Connected']} current={1} />);
    expect(screen.getByText('Choose')).toBeDefined();
    expect(screen.getByText('Configure')).toBeDefined();
    expect(screen.getByText('Connected')).toBeDefined();
    expect(screen.getByText('Configure').closest('[data-current]')?.getAttribute('data-current')).toBe('true');
  });
});
