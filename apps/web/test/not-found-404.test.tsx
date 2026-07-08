// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://nosuchorg.localhost:3000/bad/path" }
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { NotFound404 } from '../src/components/not-found-404';

afterEach(cleanup);

describe('NotFound404 — workspace variant', () => {
  test('traces the org host and names the failure without leaking org existence', () => {
    const { container } = render(<NotFound404 variant="workspace" />);
    const text = container.textContent!;
    expect(text).toContain('nosuchorg.localhost:3000');
    expect(text).toMatch(/workspace not found/i);
    expect(text).toMatch(/don't have access/i);
  });

  test('CTA points at the apex host (same protocol and port)', () => {
    render(<NotFound404 variant="workspace" />);
    const cta = screen.getByRole('link', { name: /go to your workspaces/i });
    expect(cta.getAttribute('href')).toBe('http://localhost:3000/');
  });
});

describe('NotFound404 — page variant', () => {
  test('traces the missing path and names the failure', () => {
    const { container } = render(<NotFound404 variant="page" />);
    const text = container.textContent!;
    expect(text).toContain('/bad/path');
    expect(text).toMatch(/page not found/i);
  });

  test('CTA points home', () => {
    render(<NotFound404 variant="page" />);
    const cta = screen.getByRole('link', { name: /back to home/i });
    expect(cta.getAttribute('href')).toBe('/');
  });
});
