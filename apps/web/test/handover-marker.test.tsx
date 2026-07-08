// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { HandoverMessage, ReturnMarker } from '../src/components/conversation/handover-marker';
import type { Participant } from '../src/lib/api';

afterEach(cleanup);

const triage: Participant = { key: 'c1', name: 'Triage', role: 'assistant', color: '#0ea5e9' };

describe('handover', () => {
  test('HandoverMessage reads as a message: from → to, delegated, and the task as a bubble', () => {
    render(<HandoverMessage from={triage} toName="Database Specialist" toColor="#a855f7" task="investigate the db" />);
    expect(screen.getByText('Triage → Database Specialist')).toBeDefined();
    expect(screen.getByText('delegated')).toBeDefined();
    expect(screen.getByText('investigate the db')).toBeDefined();
  });

  test('HandoverMessage with no task shows a subtle handed-off line', () => {
    render(<HandoverMessage from={triage} toName="Database Specialist" toColor="#a855f7" task={null} />);
    expect(screen.getByText(/handed off to Database Specialist/)).toBeDefined();
  });

  test('ReturnMarker shows who returned to whom', () => {
    render(<ReturnMarker fromName="Database Specialist" toName="Triage" />);
    expect(screen.getByText(/returned to Triage/)).toBeDefined();
  });
});
