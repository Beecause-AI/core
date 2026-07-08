import { describe, expect, it, vi } from 'vitest';
import { makeIdpAdmin, IdpUserExistsError } from '../src/integrations/idp/admin.js';

/** Minimal fake of the firebase-admin Auth surface makeIdpAdmin depends on. */
function fakeAuth(overrides: {
  createTenant?: (opts: unknown) => Promise<{ tenantId: string }>;
  tenant?: Partial<{
    createUser: (p: unknown) => Promise<{ uid: string }>;
    getUserByEmail: (e: string) => Promise<{ uid: string; emailVerified: boolean }>;
    updateUser: (uid: string, p: unknown) => Promise<unknown>;
    deleteUser: (uid: string) => Promise<void>;
    createProviderConfig: (c: any) => Promise<{ providerId: string }>;
    listProviderConfigs: (o: any) => Promise<{ providerConfigs: Array<{ providerId: string }> }>;
    deleteProviderConfig: (id: string) => Promise<void>;
  }>;
} = {}) {
  const authForTenant = vi.fn((_tid: string) => ({
    createUser: overrides.tenant?.createUser ?? vi.fn(async () => ({ uid: 'u-default' })),
    getUserByEmail: overrides.tenant?.getUserByEmail ?? vi.fn(async () => { throw { code: 'auth/user-not-found' }; }),
    updateUser: overrides.tenant?.updateUser ?? vi.fn(async () => ({})),
    deleteUser: overrides.tenant?.deleteUser ?? vi.fn(async () => undefined),
    createProviderConfig: overrides.tenant?.createProviderConfig ?? vi.fn(async (c: any) => ({ providerId: c.providerId })),
    listProviderConfigs: overrides.tenant?.listProviderConfigs ?? vi.fn(async () => ({ providerConfigs: [] })),
    deleteProviderConfig: overrides.tenant?.deleteProviderConfig ?? vi.fn(async () => undefined),
  }));
  const tenantManager = () => ({
    createTenant: overrides.createTenant ?? vi.fn(async () => ({ tenantId: 't-default' })),
    authForTenant,
  });
  return { tenantManager, _authForTenant: authForTenant } as unknown as Parameters<typeof makeIdpAdmin>[0] & { _authForTenant: typeof authForTenant };
}

describe('IdpAdmin', () => {
  it('createTenant enables email/password sign-in and returns the tenantId', async () => {
    const createTenant = vi.fn(async (_opts: unknown) => ({ tenantId: 'acme-x7' }));
    const auth = fakeAuth({ createTenant });
    const out = await makeIdpAdmin(auth).createTenant({ displayName: 'Acme Inc' });
    expect(out).toEqual({ tenantId: 'acme-x7' });
    const opts = createTenant.mock.calls[0]![0] as { displayName: string; emailSignInConfig: { enabled: boolean; passwordRequired: boolean } };
    expect(opts.displayName).toBe('Acme Inc');
    expect(opts.emailSignInConfig).toEqual({ enabled: true, passwordRequired: true });
  });

  it('createUser scopes to the tenant, splits name into displayName, returns uid', async () => {
    const createUser = vi.fn(async (_p: unknown) => ({ uid: 'new-uid' }));
    const auth = fakeAuth({ tenant: { createUser } });
    const out = await makeIdpAdmin(auth).createUser('t-acme', { email: 'a@b.co', password: 'pw', name: 'Ada Lovelace', emailVerified: true });
    expect(out).toEqual({ uid: 'new-uid' });
    expect(auth._authForTenant).toHaveBeenCalledWith('t-acme');
    const props = createUser.mock.calls[0]![0] as { email: string; password: string; displayName: string; emailVerified: boolean; uid?: string };
    expect(props).toMatchObject({ email: 'a@b.co', password: 'pw', displayName: 'Ada Lovelace', emailVerified: true });
    expect(props.uid).toBeUndefined();
  });

  it('createUser forwards an explicit uid when given (preserves Keycloak sub)', async () => {
    const createUser = vi.fn(async (_p: unknown) => ({ uid: 'kc-sub-123' }));
    const auth = fakeAuth({ tenant: { createUser } });
    await makeIdpAdmin(auth).createUser('t-acme', { uid: 'kc-sub-123', email: 'a@b.co', password: 'pw', name: 'A B', emailVerified: true });
    expect((createUser.mock.calls[0]![0] as { uid?: string }).uid).toBe('kc-sub-123');
  });

  it('createUser maps the already-exists error to IdpUserExistsError', async () => {
    const createUser = vi.fn(async () => { throw { code: 'auth/email-already-exists' }; });
    const auth = fakeAuth({ tenant: { createUser } });
    await expect(makeIdpAdmin(auth).createUser('t-acme', { email: 'a@b.co', password: 'pw', name: 'A B', emailVerified: true }))
      .rejects.toBeInstanceOf(IdpUserExistsError);
  });

  it('findUserByEmail returns uid + emailVerified, and null on not-found', async () => {
    const found = fakeAuth({ tenant: { getUserByEmail: vi.fn(async () => ({ uid: 'u9', emailVerified: false })) } });
    expect(await makeIdpAdmin(found).findUserByEmail('t-acme', 'a@b.co')).toEqual({ uid: 'u9', emailVerified: false });

    const missing = fakeAuth({ tenant: { getUserByEmail: vi.fn(async () => { throw { code: 'auth/user-not-found' }; }) } });
    expect(await makeIdpAdmin(missing).findUserByEmail('t-acme', 'x@y.co')).toBeNull();
  });

  it('updateUser sets displayName from firstName + lastName', async () => {
    const updateUser = vi.fn(async () => ({}));
    const auth = fakeAuth({ tenant: { updateUser } });
    await makeIdpAdmin(auth).updateUser('t-acme', 'u1', { firstName: 'Ada', lastName: 'Lovelace' });
    expect(updateUser).toHaveBeenCalledWith('u1', { displayName: 'Ada Lovelace' });
  });

  it('deleteUser delegates to the tenant auth', async () => {
    const deleteUser = vi.fn(async () => undefined);
    const auth = fakeAuth({ tenant: { deleteUser } });
    await makeIdpAdmin(auth).deleteUser('t-acme', 'u1');
    expect(deleteUser).toHaveBeenCalledWith('u1');
  });

  it('createUser maps uid-already-exists to IdpUserExistsError', async () => {
    const createUser = vi.fn(async () => { throw { code: 'auth/uid-already-exists' }; });
    const auth = fakeAuth({ tenant: { createUser } });
    await expect(makeIdpAdmin(auth).createUser('t-acme', { uid: 'dup', email: 'a@b.co', password: 'pw', name: 'A B', emailVerified: true }))
      .rejects.toBeInstanceOf(IdpUserExistsError);
  });

  it('createUser rethrows unmapped errors unchanged', async () => {
    const boom = { code: 'auth/internal-error' };
    const createUser = vi.fn(async () => { throw boom; });
    const auth = fakeAuth({ tenant: { createUser } });
    await expect(makeIdpAdmin(auth).createUser('t-acme', { email: 'a@b.co', password: 'pw', name: 'A B', emailVerified: true }))
      .rejects.toBe(boom);
  });

  it('deleteUser treats user-not-found as a no-op (idempotent)', async () => {
    const deleteUser = vi.fn(async () => { throw { code: 'auth/user-not-found' }; });
    const auth = fakeAuth({ tenant: { deleteUser } });
    await expect(makeIdpAdmin(auth).deleteUser('t-acme', 'gone')).resolves.toBeUndefined();
  });
});

describe('IdpAdmin provider config', () => {
  it('createSamlProvider builds a saml.* config scoped to the tenant and returns the providerId', async () => {
    const createProviderConfig = vi.fn(async (c: { providerId: string }) => ({ providerId: c.providerId }));
    const auth = fakeAuth({ tenant: { createProviderConfig } });
    const out = await makeIdpAdmin(auth).createSamlProvider('t-acme', {
      providerId: 'saml.acme', displayName: 'Acme Okta',
      idpEntityId: 'https://idp/entity', ssoUrl: 'https://idp/sso',
      x509Certificates: ['CERT'], rpEntityId: 'https://acme.beecause.ai', callbackUrl: 'https://acme.beecause.ai/__/auth/handler',
    });
    expect(out).toEqual({ providerId: 'saml.acme' });
    expect(auth._authForTenant).toHaveBeenCalledWith('t-acme');
    const cfg = createProviderConfig.mock.calls[0]![0] as { providerId: string; displayName: string; enabled: boolean };
    expect(cfg.providerId).toBe('saml.acme');
    expect(cfg.enabled).toBe(true);
  });

  it('createOidcProvider builds an oidc.* config (code flow) and returns the providerId', async () => {
    const createProviderConfig = vi.fn(async (c: { providerId: string }) => ({ providerId: c.providerId }));
    const auth = fakeAuth({ tenant: { createProviderConfig } });
    const out = await makeIdpAdmin(auth).createOidcProvider('t-acme', {
      providerId: 'oidc.acme', displayName: 'Acme Entra',
      issuer: 'https://login.microsoftonline.com/x/v2.0', clientId: 'cid', clientSecret: 'secret',
    });
    expect(out).toEqual({ providerId: 'oidc.acme' });
    const cfg = createProviderConfig.mock.calls[0]![0] as { providerId: string; enabled: boolean };
    expect(cfg.providerId).toBe('oidc.acme');
    expect(cfg.enabled).toBe(true);
  });

  it('listProviders returns provider ids across saml + oidc', async () => {
    const listProviderConfigs = vi.fn(async ({ type }: { type: 'saml' | 'oidc' }) =>
      ({ providerConfigs: type === 'saml' ? [{ providerId: 'saml.acme' }] : [{ providerId: 'oidc.acme' }] }));
    const auth = fakeAuth({ tenant: { listProviderConfigs } });
    expect(await makeIdpAdmin(auth).listProviders('t-acme')).toEqual(['saml.acme', 'oidc.acme']);
  });

  it('deleteProvider delegates to the tenant auth', async () => {
    const deleteProviderConfig = vi.fn(async () => undefined);
    const auth = fakeAuth({ tenant: { deleteProviderConfig } });
    await makeIdpAdmin(auth).deleteProvider('t-acme', 'saml.acme');
    expect(deleteProviderConfig).toHaveBeenCalledWith('saml.acme');
  });
});
