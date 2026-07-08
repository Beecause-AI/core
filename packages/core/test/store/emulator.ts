import { Firestore } from '@google-cloud/firestore';
import { FirestoreStore } from '../../src/adapters/store/firestore.js';
import { InMemoryVectorIndex } from '../../src/store/vector.js';
import type { Store } from '../../src/store/firestore.js';

const HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';

let counter = 0;

// Map from DocStore -> raw Firestore so wipe() can list/delete collections.
const rawFsMap = new WeakMap<object, Firestore>();

/** A fresh Store per test, isolated by a unique projectId so collections never collide
 *  across tests in the same emulator. Requires the Firestore emulator (`make dev-up`). */
export function testStore(name: string): Store {
  process.env.FIRESTORE_EMULATOR_HOST = HOST;
  // Match prod createStore: drop undefined (incl. nested) like Postgres jsonb did.
  const rawFs = new Firestore({ projectId: `test-${name}-${process.pid}-${counter++}`, ignoreUndefinedProperties: true });
  const db = new FirestoreStore(rawFs);
  rawFsMap.set(db, rawFs);
  return { db, vector: new InMemoryVectorIndex(), close: () => db.close() };
}

/** Delete every document in every collection of a test store (between cases). */
export async function wipe(db: object): Promise<void> {
  const fs = rawFsMap.get(db) ?? (db instanceof Firestore ? db : null);
  if (!fs) throw new Error('wipe: no raw Firestore found for this DocStore — pass store.db');
  const cols = await fs.listCollections();
  for (const c of cols) {
    const docs = await c.listDocuments();
    await Promise.all(docs.map((d) => d.delete()));
  }
}
