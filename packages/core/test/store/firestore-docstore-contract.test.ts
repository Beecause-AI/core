import { randomUUID } from 'node:crypto';
import { Firestore } from '@google-cloud/firestore';
import { docStoreContract } from '../../testing/port-contracts/store.js';
import { FirestoreStore } from '../../src/adapters/store/firestore.js';

const HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';

docStoreContract('firestore', () => {
  process.env.FIRESTORE_EMULATOR_HOST = HOST;
  // Fresh projectId per test → isolated collections in the shared emulator.
  const db = new Firestore({ projectId: `t-ds-${randomUUID()}`, ignoreUndefinedProperties: true });
  return new FirestoreStore(db);
});
