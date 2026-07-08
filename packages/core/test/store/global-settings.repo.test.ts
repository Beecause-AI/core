import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { testStore, wipe } from './emulator.js';
import {
  getGlobalSetting,
  setGlobalSetting,
  getPlanLimits,
  setPlanLimits,
} from '../../src/repos/global-settings.js';

const store = testStore('global-settings');
const db = store.db;

beforeEach(() => wipe(db));
afterAll(() => store.close());

describe('global-settings repo (Firestore)', () => {
  it('returns null for an unset key', async () => {
    expect(await getGlobalSetting(db, 'missing')).toBeNull();
  });

  it('sets then gets a value', async () => {
    await setGlobalSetting(db, 'feature.x', { on: true });
    expect(await getGlobalSetting(db, 'feature.x')).toEqual({ on: true });
  });

  it('upserts (second set overwrites)', async () => {
    await setGlobalSetting(db, 'k', 1);
    await setGlobalSetting(db, 'k', 2);
    expect(await getGlobalSetting(db, 'k')).toBe(2);
  });

  it('plan limits default to {} and round-trip', async () => {
    expect(await getPlanLimits(db)).toEqual({});
    const limits = { free: { maxProjects: 3, maxMembersPerOrg: null, maxAssistantsPerProject: 5, monthlyAiUsageTokens: null } };
    await setPlanLimits(db, limits);
    expect(await getPlanLimits(db)).toEqual(limits);
  });
});
