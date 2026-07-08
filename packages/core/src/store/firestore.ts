import { Firestore } from '@google-cloud/firestore';
import { Pool } from 'pg';
import { FirestoreStore } from '../adapters/store/firestore.js';
import { PgStore } from '../adapters/store/postgres.js';
import { FirestoreVectorIndex, VertexVectorIndex, DisabledVectorIndex, vectorConfigured, type VectorIndex, type VertexVectorConfig } from './vector.js';
import { InMemoryVectorIndex } from '../adapters/vector/in-memory.js';
import { PgVectorIndex } from '../adapters/vector/pgvector.js';
import type { DocStore } from '../ports/store.js';

export type StoreConfig = {
  /** 'firestore' (default, SaaS) or 'postgres' (OSS self-host). */
  backend?: 'firestore' | 'postgres';
  /** Postgres connection string (backend='postgres'). */
  databaseUrl?: string;
  /**
   * Vector backend for the Postgres self-host.
   * 'inmemory' (default) — non-persistent in-memory index, good for dev/eval.
   * 'pgvector'           — persistent Postgres + pgvector; schema is ensured lazily
   *                        on first upsert/findNeighbors (no await in createStore).
   * Falls back to DisabledVectorIndex if unset under the Postgres backend.
   */
  vectorBackend?: 'inmemory' | 'pgvector';
  /**
   * Embedding dimension for pgvector (default 768).
   * Ignored when vectorBackend !== 'pgvector'.
   */
  vectorDim?: number;
  /**
   * @deprecated Use vectorBackend='inmemory' instead.
   * Kept for backwards compatibility — maps to vectorBackend='inmemory'.
   */
  vectorInMemory?: boolean;
  projectId: string;
  /** when set (local/test), points the SDK at the emulator and skips creds */
  emulatorHost?: string;
  /** when true, use Firestore native vector search (budget-friendly, no deployed endpoint)
   *  instead of Vertex. Takes precedence over `vector`. */
  firestoreVector?: boolean;
  vector: VertexVectorConfig;
};

export type Store = { db: DocStore; vector: VectorIndex; close(): Promise<void> };

export function createStore(cfg: StoreConfig): Store {
  if (cfg.backend === 'postgres') {
    if (!cfg.databaseUrl) throw new Error('createStore: backend=postgres requires databaseUrl');
    const pool = new Pool({ connectionString: cfg.databaseUrl });
    const db = new PgStore(pool);
    // Resolve effective vector backend: explicit vectorBackend wins; legacy vectorInMemory maps to 'inmemory'.
    const effectiveBackend = cfg.vectorBackend ?? (cfg.vectorInMemory ? 'inmemory' : undefined);
    let vector: VectorIndex;
    if (effectiveBackend === 'pgvector') {
      const dim = cfg.vectorDim ?? 768;
      vector = new PgVectorIndex(pool, { dim });
    } else if (effectiveBackend === 'inmemory') {
      vector = new InMemoryVectorIndex();
    } else {
      vector = new DisabledVectorIndex();
    }
    return { db, vector, close: () => pool.end() };
  }
  // firestore (default) — unchanged
  if (cfg.emulatorHost) process.env.FIRESTORE_EMULATOR_HOST = cfg.emulatorHost;
  const fs = new Firestore({ projectId: cfg.projectId, ignoreUndefinedProperties: true });
  const vector = cfg.firestoreVector
    ? new FirestoreVectorIndex(fs)
    : vectorConfigured(cfg.vector)
      ? new VertexVectorIndex(cfg.projectId, cfg.vector)
      : new DisabledVectorIndex();
  const db = new FirestoreStore(fs);
  return { db, vector, close: () => db.close() };
}

/** `Db` is now the DocStore port (was Firestore). Repos keep `import type { Db }` from here. */
export type Db = DocStore;
