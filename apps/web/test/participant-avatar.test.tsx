// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { ParticipantAvatar } from '../src/components/conversation/participant-avatar';

afterEach(cleanup);

describe('ParticipantAvatar', () => {
  test('renders initials from the name and applies the color', () => {
    render(<ParticipantAvatar name="Database Specialist" color="#a855f7" />);
    const el = screen.getByText('DS');
    expect(el).toBeDefined();
    expect((el as HTMLElement).style.backgroundColor).toBe('rgb(168, 85, 247)');
  });

  test('single-word names use the first two letters', () => {
    render(<ParticipantAvatar name="Triage" color="#0ea5e9" />);
    expect(screen.getByText('TR')).toBeDefined();
  });
});
