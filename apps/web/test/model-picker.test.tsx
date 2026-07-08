// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ModelPicker } from '../src/components/project/model-picker';
import type { ModelGroup } from '../src/lib/api';

afterEach(() => cleanup());

const groups: ModelGroup[] = [
  { provider: 'platform', label: 'Platform (included)', source: 'platform', models: [
    { id: 'gemini-3-flash-preview', displayName: 'Gemini 3 Flash', origin: 'curated', capabilities: { tools: false, streaming: true }, pricing: { inputPer1M: 0.075, outputPer1M: 0.30 } },
    { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', origin: 'curated', capabilities: { tools: true, streaming: true }, pricing: { inputPer1M: 3, outputPer1M: 15 } },
  ] },
];

describe('ModelPicker', () => {
  test('renders model names and sortable price columns', () => {
    render(<ModelPicker groups={groups} value={{ model: 'gemini-3-flash-preview', provider: 'platform' }} onChange={() => {}} />);
    expect(screen.getByText('Gemini 3 Flash')).toBeDefined();
    expect(screen.getByText('Claude Sonnet 4.6')).toBeDefined();
    expect(screen.getByText(/Input/)).toBeDefined();
    expect(screen.getByText(/Output/)).toBeDefined();
  });

  test('renders per-model pricing in cells', () => {
    render(<ModelPicker groups={groups} value={null} onChange={() => {}} />);
    expect(screen.getByText('$0.07')).toBeDefined(); // 0.075 → toFixed(2)
    expect(screen.getByText('$0.30')).toBeDefined();
    expect(screen.getByText('$3.00')).toBeDefined();
    expect(screen.getByText('$15.00')).toBeDefined();
  });

  test('sorts by output price when the Output header is clicked', () => {
    render(<ModelPicker groups={groups} value={null} onChange={() => {}} />);
    // default sort is input asc → Gemini (0.075) before Claude (3); click Output → still asc by output (0.30 < 15) so order holds,
    // click again → desc by output → Claude (15) first.
    fireEvent.click(screen.getByText(/Output/));
    fireEvent.click(screen.getByText(/Output/));
    const names = screen.getAllByRole('row').slice(1).map((r) => r.querySelector('td')?.textContent ?? '');
    expect(names[0]).toContain('Claude Sonnet 4.6');
  });

  test('selecting a row reports model + provider', () => {
    const onChange = vi.fn();
    render(<ModelPicker groups={groups} value={null} onChange={onChange} />);
    fireEvent.click(screen.getByText('Claude Sonnet 4.6'));
    expect(onChange).toHaveBeenCalledWith({ model: 'claude-sonnet-4-6', provider: 'platform' });
  });

  test('search filters rows', () => {
    render(<ModelPicker groups={groups} value={null} onChange={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/search models/i), { target: { value: 'sonnet' } });
    expect(screen.queryByText('Gemini 3 Flash')).toBeNull();
    expect(screen.getByText('Claude Sonnet 4.6')).toBeDefined();
  });
});
