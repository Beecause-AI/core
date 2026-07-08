// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import SignInPage from '../src/app/signin/page';
import * as idp from '../src/lib/idp-auth';

vi.mock('../src/lib/idp-auth', () => ({
  passwordSignIn: vi.fn(),
  startSso: vi.fn(),
  completeSsoRedirect: vi.fn(async () => false),
}));

function mockSsoInfo(info: { ssoEnabled: boolean; tenantId: string | null; providerId: string | null }) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(info), { status: 200 }));
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('SignInPage', () => {
  it('password sign-in posts and redirects on success', async () => {
    mockSsoInfo({ ssoEnabled: false, tenantId: null, providerId: null });
    const orig = window.location; Object.defineProperty(window, 'location', { value: { ...orig, href: '' }, writable: true });
    render(<SignInPage />);
    await waitFor(() => screen.getByLabelText(/email/i));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(idp.passwordSignIn).toHaveBeenCalledWith('a@b.co', 'pw'));
  });

  it('shows the SSO button when the org has SSO enabled and calls startSso', async () => {
    mockSsoInfo({ ssoEnabled: true, tenantId: 'tenant-acme', providerId: 'saml.acme' });
    render(<SignInPage />);
    const ssoBtn = await screen.findByRole('button', { name: /single sign-on|sso/i });
    fireEvent.click(ssoBtn);
    await waitFor(() => expect(idp.startSso).toHaveBeenCalledWith('tenant-acme', 'saml.acme'));
  });

  it('shows an error on invalid credentials', async () => {
    mockSsoInfo({ ssoEnabled: false, tenantId: null, providerId: null });
    (idp.passwordSignIn as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('invalid'));
    render(<SignInPage />);
    await waitFor(() => screen.getByLabelText(/email/i));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/incorrect|invalid/i)).toBeTruthy();
  });
});
