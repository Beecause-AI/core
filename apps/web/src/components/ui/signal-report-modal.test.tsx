// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { SignalReportModal } from './signal-report-modal';
import type { SignalSection } from './signal-pills';

afterEach(() => cleanup());

const sections: SignalSection[] = [
  { key: 'monitoring', label: 'Metrics' },
  { key: 'errors', label: 'Errors' },
];

describe('SignalReportModal', () => {
  test('shows per-signal status and the raw error for failures', () => {
    render(
      <SignalReportModal
        open
        onClose={vi.fn()}
        sections={sections}
        report={{
          monitoring: { ok: true },
          errors: { ok: false, error: 'GCP 403: API has not been used — grant roles/errorreporting.viewer' },
        }}
      />,
    );
    expect(screen.getByText('Available')).toBeDefined();
    expect(screen.getByText('Failed')).toBeDefined();
    // Raw error is shown verbatim for the failed signal.
    expect(screen.getByText(/grant roles\/errorreporting\.viewer/)).toBeDefined();
  });

  test('renders nothing when there is no report', () => {
    const { container } = render(
      <SignalReportModal open onClose={vi.fn()} sections={sections} report={null} />,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  test('closes on the close button', () => {
    const onClose = vi.fn();
    render(
      <SignalReportModal
        open
        onClose={onClose}
        sections={sections}
        report={{ monitoring: { ok: true }, errors: { ok: true } }}
      />,
    );
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });
});
