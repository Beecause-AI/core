import { SignJWT, jwtVerify } from 'jose';

// idt: the raw OIDC id_token from the login that minted this session — replayed
// as id_token_hint at logout so Keycloak skips its confirmation interstitial.
// Absent for auto-provisioned sessions (no KC SSO session exists for those).
export type SessionUser = { sub: string; email?: string; name?: string; idt?: string };
/** PKCE verifier + state (+ return host h, org slug o, return path r) carried between /auth/login and /auth/callback. */
export type OidcTxn = { v: string; s: string; h?: string; o?: string; r?: string };

/** Firebase Hosting forwards ONLY a cookie named __session to Cloud Run. */
export const SESSION_COOKIE = '__session';

/**
 * All values of `name` in a raw Cookie header. Because everything must ride the
 * __session name, the host-only txn cookie and the Domain-wide session cookie can
 * coexist as DUPLICATES mid-login — req.cookies keeps only one of them, so readers
 * must scan all values for the kind they expect.
 */
export function cookieValues(header: string | undefined, name: string): string[] {
  if (!header) return [];
  return header
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p.startsWith(`${name}=`))
    .map((p) => p.slice(name.length + 1));
}

/** The first __session value that verifies as a session, or null. */
export async function sessionFromCookieHeader(header: string | undefined, secret: string): Promise<SessionUser | null> {
  for (const v of cookieValues(header, SESSION_COOKIE)) {
    const user = await verifySessionToken(v, secret);
    if (user) return user;
  }
  return null;
}

/** The first __session value that verifies as an OIDC txn, or null. */
export async function txnFromCookieHeader(header: string | undefined, secret: string): Promise<OidcTxn | null> {
  for (const v of cookieValues(header, SESSION_COOKIE)) {
    const txn = await verifyTxnToken(v, secret);
    if (txn) return txn;
  }
  return null;
}

async function sign(payload: Record<string, unknown>, secret: string, exp: string) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(secret));
}

async function verify(token: string, secret: string) {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ['HS256'],
    });
    return payload;
  } catch {
    return null;
  }
}

export async function createSessionToken(user: SessionUser, secret: string): Promise<string> {
  return new SignJWT({ kind: 'session', email: user.email, name: user.name, ...(user.idt ? { idt: user.idt } : {}) })
    .setSubject(user.sub)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(new TextEncoder().encode(secret));
}

export async function verifySessionToken(token: string, secret: string): Promise<SessionUser | null> {
  const payload = await verify(token, secret);
  if (!payload || payload.kind !== 'session' || !payload.sub) return null;
  return {
    sub: payload.sub,
    email: payload.email as string | undefined,
    name: payload.name as string | undefined,
    ...(payload.idt ? { idt: payload.idt as string } : {}),
  };
}

export async function createTxnToken(txn: OidcTxn, secret: string): Promise<string> {
  return sign(
    { kind: 'txn', v: txn.v, s: txn.s, ...(txn.h ? { h: txn.h } : {}), ...(txn.o ? { o: txn.o } : {}), ...(txn.r ? { r: txn.r } : {}) },
    secret,
    '10m',
  );
}

export async function verifyTxnToken(token: string, secret: string): Promise<OidcTxn | null> {
  const payload = await verify(token, secret);
  if (!payload || payload.kind !== 'txn') return null;
  return {
    v: payload.v as string,
    s: payload.s as string,
    ...(payload.h ? { h: payload.h as string } : {}),
    ...(payload.o ? { o: payload.o as string } : {}),
    ...(payload.r ? { r: payload.r as string } : {}),
  };
}

// No kcUserId: the KC user doesn't exist yet — /api/auth/complete creates the
// realm + user from these claims after the email round-trip proves ownership.
export type VerifyToken = { slug: string; email: string; name: string };

export async function createVerifyToken(v: VerifyToken, secret: string): Promise<string> {
  return sign({ kind: 'verify', slug: v.slug, email: v.email, name: v.name }, secret, '24h');
}

export async function verifyVerifyToken(token: string, secret: string): Promise<VerifyToken | null> {
  const payload = await verify(token, secret);
  if (!payload || payload.kind !== 'verify' || !payload.slug || !payload.email || !payload.name) return null;
  return { slug: payload.slug as string, email: payload.email as string, name: payload.name as string };
}

// Emailed to an org-member invitee. The JWT only proves email ownership and
// points at the org_invitations row — pending/revoked/accepted state lives in
// the DB (same split as signup: pending org row + verify JWT).
export type InviteToken = { slug: string; email: string; invitationId: string };

export async function createInviteToken(v: InviteToken, secret: string): Promise<string> {
  return sign({ kind: 'invite', slug: v.slug, email: v.email, inv: v.invitationId }, secret, '7d');
}

export async function verifyInviteToken(token: string, secret: string): Promise<InviteToken | null> {
  const payload = await verify(token, secret);
  if (!payload || payload.kind !== 'invite' || !payload.slug || !payload.email || !payload.inv) return null;
  return { slug: payload.slug as string, email: payload.email as string, invitationId: payload.inv as string };
}
