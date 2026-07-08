import { Firestore } from '@google-cloud/firestore';
import type { Store } from '@intellilabs/core';
import { InMemoryVectorIndex } from '../../../packages/core/src/store/vector.js';
import { FirestoreStore } from '../../../packages/core/src/adapters/store/firestore.js';
import type { AppConfig } from '../src/config.js';
import { IdpUserExistsError } from '../src/integrations/idp/admin.js';

const HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';

export const testConfig: AppConfig = {
  GCP_PROJECT_ID: 'test-project',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  VECTOR_LOCATION: '',
  VECTOR_INDEX_ID: '',
  VECTOR_INDEX_ENDPOINT_ID: '',
  VECTOR_DEPLOYED_INDEX_ID: '',
  SESSION_SECRET: 't'.repeat(32),
  BASE_URL: 'https://beecause.ai',
  PORT: 0,
  NODE_ENV: 'test',
  AUTO_VERIFY_EMAIL: false,
  EMAIL_FROM: 'no-reply@beecause.ai',
  SUPER_ADMIN_EMAILS: 'admin@example.com',
  FIREBASE_PROJECT_ID: 'test-project',
  VERTEX_LOCATION: 'global',
  CREDITS_ENFORCED: false,
  BILLING_FX_USD_EUR: 0.92,
};

export function fakeIdpAdmin() {
  const tenants = new Map<string, Map<string, { uid: string; email: string; emailVerified: boolean; displayName?: string }>>();
  let t = 0, u = 0;
  return {
    tenants,
    api: {
      async createTenant({ displayName: _d }: { displayName: string }) { const id = `tenant-${++t}`; tenants.set(id, new Map()); return { tenantId: id }; },
      async createUser(tenantId: string, { uid, email, name, emailVerified }: { uid?: string; email: string; password: string; name: string; emailVerified: boolean }) {
        const users = tenants.get(tenantId); if (!users) throw new Error(`fake idp: tenant ${tenantId} does not exist`);
        for (const x of users.values()) if (x.email === email) throw new IdpUserExistsError();
        const id = uid ?? `idp-${++u}`; users.set(id, { uid: id, email, emailVerified, displayName: name }); return { uid: id };
      },
      async findUserByEmail(tenantId: string, email: string) { for (const x of tenants.get(tenantId)?.values() ?? []) if (x.email === email) return { uid: x.uid, emailVerified: x.emailVerified }; return null; },
      async updateUser(tenantId: string, uid: string, { firstName, lastName }: { firstName: string; lastName: string }) { const x = tenants.get(tenantId)?.get(uid); if (x) x.displayName = `${firstName} ${lastName}`.trim(); },
      async deleteUser(tenantId: string, uid: string) { tenants.get(tenantId)?.delete(uid); },
      async createSamlProvider(_t: string, p: { providerId: string }) { return { providerId: p.providerId }; },
      async createOidcProvider(_t: string, p: { providerId: string }) { return { providerId: p.providerId }; },
      async listProviders(_t: string) { return [] as string[]; },
      async deleteProvider(_t: string, _p: string) { /* no-op */ },
    },
  };
}

export function fakeEmail() {
  const sent: Array<{ to: string; subject: string; html: string }> = [];
  return { sent, api: { async send(m: { to: string; subject: string; html: string }) { sent.push(m); } } };
}

let counter = 0;

/** Throwaway Firestore-emulator store. Each call gets a unique projectId so collections
 *  never collide across concurrent test runs on the shared emulator. No migrate step. */
export async function startTestDb() {
  process.env.FIRESTORE_EMULATOR_HOST = HOST;
  const projectId = `test-srv-${process.pid}-${Date.now()}-${counter++}`;
  const raw = new Firestore({ projectId });
  const store: Store = { db: new FirestoreStore(raw), vector: new InMemoryVectorIndex(), close: () => raw.terminate() };
  return {
    // `db` is the DocStore port that buildApp + repos consume; `raw` (kept private, used by
    // stop()) is the underlying Firestore handle for collection teardown.
    db: store.db,
    store,
    async stop() {
      const cols = await raw.listCollections();
      for (const c of cols) {
        const docs = await c.listDocuments();
        await Promise.all(docs.map((d) => d.delete()));
      }
      await raw.terminate();
    },
  };
}
