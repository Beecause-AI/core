// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { UserMenu } from '../src/components/ui/user-menu';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function stubMe(me: { name?: string; email?: string }) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ sub: 'u1', ...me }), { status: 200 })));
}

describe('UserMenu', () => {
  test('renders the user name and reveals items on click', async () => {
    stubMe({ name: 'Ada Lovelace', email: 'ada@x.dev' });
    render(<UserMenu />);
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeDefined());

    expect(screen.queryByRole('menuitem', { name: /sign out/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    expect(screen.getByRole('menuitem', { name: /profile/i })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /api keys/i })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeDefined();
  });

  test('falls back to email when there is no name', async () => {
    stubMe({ email: 'ada@x.dev' });
    render(<UserMenu />);
    await waitFor(() => expect(screen.getByText('ada@x.dev')).toBeDefined());
  });

  test('closes when Escape is pressed', async () => {
    stubMe({ name: 'Ada', email: 'ada@x.dev' });
    render(<UserMenu />);
    await waitFor(() => expect(screen.getByText('Ada')).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    expect(screen.getByRole('menuitem', { name: /profile/i })).toBeDefined();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: /profile/i })).toBeNull());
  });

  test('closes on outside mousedown', async () => {
    stubMe({ name: 'Ada', email: 'ada@x.dev' });
    render(<UserMenu />);
    await waitFor(() => expect(screen.getByText('Ada')).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    expect(screen.getByRole('menuitem', { name: /profile/i })).toBeDefined();
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: /profile/i })).toBeNull());
  });

  test('falls back to "Account" when /api/me fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    render(<UserMenu />);
    await waitFor(() => expect(screen.getByRole('button', { name: /account menu/i })).toBeDefined());
    expect(screen.getByText('Account')).toBeDefined();
  });

  test('Profile and API keys link to their settings routes', async () => {
    stubMe({ name: 'Ada', email: 'ada@x.dev' });
    render(<UserMenu />);
    await waitFor(() => expect(screen.getByText('Ada')).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    expect(screen.getByRole('menuitem', { name: /profile/i }).getAttribute('href')).toBe('/settings/profile');
    expect(screen.getByRole('menuitem', { name: /api keys/i }).getAttribute('href')).toBe('/settings/api-keys');
  });
});
