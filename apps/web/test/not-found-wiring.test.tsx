// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://nosuchorg.localhost:3000/" }
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import NotFound from '../src/app/not-found';
import Page from '../src/app/page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('app/not-found.tsx', () => {
  test('renders the page-variant terminal 404', () => {
    render(<NotFound />);
    expect(screen.getByText(/page not found/i)).toBeDefined();
  });
});

describe('org host whose org the API 404s', () => {
  test('takes over the page with the workspace-variant 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'not found' }), { status: 404 })),
    );
    render(<Page />);
    await waitFor(() => expect(screen.getByText(/workspace not found/i)).toBeDefined());
    expect(screen.getByRole('link', { name: /go to your workspaces/i })).toBeDefined();
  });
});
