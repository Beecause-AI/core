import { Firestore } from '@google-cloud/firestore';
import type { Db, Store } from '@intellilabs/core';
import { FirestoreStore } from '../../../packages/core/src/adapters/store/firestore.js';
import type { WorkerConfig } from '../src/config.js';

const HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';

let counter = 0;

/** A minimal in-memory vector index for tests. Mirrors the shape of core's
 *  VectorIndex (upsert/remove/findNeighbors) without the Vertex dependency.
 *  findNeighbors always returns [] — none of the engine-worker tests exercise
 *  real ANN ranking; they only need the Store to carry a usable `vector` handle. */
function inMemoryVector(): Store['vector'] {
  return {
    async upsert() {},
    async remove() {},
    async findNeighbors() {
      return [];
    },
  };
}

export interface TestDb {
  /** DocStore port — what repos + engine deps consume. */
  db: Db;
  store: Store;
  stop(): Promise<void>;
}

/** Spin up a fresh store against the shared emulator, isolated by a unique projectId so
 *  collections never collide across concurrent test runs. Returns the DocStore `db`, a
 *  `store` ({ db, vector, close }) for code that needs the Store, and a `stop()` that wipes
 *  every collection then terminates the underlying handle. */
export function startTestDb(): TestDb {
  process.env.FIRESTORE_EMULATOR_HOST = HOST;
  const projectId = `test-ew-${process.pid}-${counter++}`;
  // ignoreUndefinedProperties mirrors what production createStore SHOULD set: the sub-agent
  // payload builders (subagent.ts parentLink/childPayloadBase) emit optional fields as
  // `undefined`, which Firestore rejects by default. pg's jsonb silently dropped them. See the
  // SOURCE BUG note in the migration report — without this, real delegations crash in prod too.
  const raw = new Firestore({ projectId, ignoreUndefinedProperties: true });
  const store: Store = { db: new FirestoreStore(raw), vector: inMemoryVector(), close: () => raw.terminate() };
  return {
    db: store.db,
    store,
    async stop() {
      await wipeRaw(raw);
      await raw.terminate();
    },
  };
}

/** Delete every document in every collection of a test db (between cases). Operates on the
 *  raw Firestore handle (collection enumeration is not part of the DocStore port). */
async function wipeRaw(db: Firestore): Promise<void> {
  const cols = await db.listCollections();
  for (const c of cols) {
    const docs = await c.listDocuments();
    await Promise.all(docs.map((d) => d.delete()));
  }
}

/** A valid WorkerConfig for tests: no DATABASE_URL (Firestore now); points the
 *  SDK at the emulator and leaves the Vertex Vector Search fields empty/default
 *  so vector calls are inert. */
export function testConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    GCP_PROJECT_ID: 'test-ew',
    FIRESTORE_EMULATOR_HOST: HOST,
    VECTOR_LOCATION: 'us-central1',
    VECTOR_INDEX_ID: '',
    VECTOR_INDEX_ENDPOINT_ID: '',
    VECTOR_DEPLOYED_INDEX_ID: '',
    PORT: 8080,
    NODE_ENV: 'test',
    VERTEX_LOCATION: 'global',
    CREDITS_ENFORCED: false,
    BILLING_FX_USD_EUR: 0.92,
    ...overrides,
  };
}
