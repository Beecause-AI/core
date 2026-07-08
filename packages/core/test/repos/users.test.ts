import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testStore, wipe } from '../store/emulator.js';
import { upsertUser, getUserByEmail, setUserPassword } from '../../src/repos/users.js';
import { hashPassword, verifyPassword } from '../../src/crypto/password.js';

const store = testStore('users-repo');
const db = store.db;
beforeEach(() => wipe(db));
afterAll(() => store.close());

describe('getUserByEmail', () => {
  it('returns null when no user with that email exists', async () => {
    const result = await getUserByEmail(db, 'nobody@example.com');
    expect(result).toBeNull();
  });

  it('returns the user after upsertUser', async () => {
    await upsertUser(db, { userId: 'u-1', email: 'alice@example.com' });
    const result = await getUserByEmail(db, 'alice@example.com');
    expect(result).not.toBeNull();
    expect(result!.email).toBe('alice@example.com');
    expect(result!.id).toBe('u-1');
  });

  it('is case-insensitive (lowercases input)', async () => {
    await upsertUser(db, { userId: 'u-2', email: 'bob@example.com' });
    const result = await getUserByEmail(db, 'BOB@EXAMPLE.COM');
    expect(result).not.toBeNull();
    expect(result!.email).toBe('bob@example.com');
  });
});

describe('setUserPassword', () => {
  it('stores the password hash and getUserByEmail returns it', async () => {
    await upsertUser(db, { userId: 'u-3', email: 'carol@example.com' });
    const hash = hashPassword('s3cr3t');
    await setUserPassword(db, 'u-3', hash);
    const user = await getUserByEmail(db, 'carol@example.com');
    expect(user).not.toBeNull();
    expect(user!.passwordHash).toBe(hash);
    expect(verifyPassword('s3cr3t', user!.passwordHash)).toBe(true);
    expect(verifyPassword('wrong', user!.passwordHash)).toBe(false);
  });
});
