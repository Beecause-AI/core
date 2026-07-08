import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults } from '../store/codec.js';
import type { McpServer } from '../store/types.js';
import { decryptSecret } from '../crypto/secrets.js';

export interface NewMcpServer { orgId: string; name: string; url: string; authType?: 'none' | 'bearer'; secretCiphertext?: string | null; }

/** Postgres-compatible unique-violation error so callers/tests keep matching `code === '23505'`. */
function uniqueViolation(constraint: string): Error & { code: string } {
  const err = new Error(`duplicate key value violates unique constraint "${constraint}"`) as Error & { code: string };
  err.code = '23505';
  return err;
}

export async function createMcpServer(db: Db, input: NewMcpServer): Promise<McpServer> {
  // Enforce unique(orgId, name) (Postgres had a unique index; Firestore does not).
  const dup = await col(db, 'mcp_servers')
    .where('orgId', '==', input.orgId).where('name', '==', input.name).limit(1).get();
  if (dup.length > 0) throw uniqueViolation('mcp_servers_org_name');

  const ref = col(db, 'mcp_servers').doc();
  const row = applyDefaults({
    orgId: input.orgId, name: input.name, url: input.url,
    authType: input.authType ?? 'none', secretCiphertext: input.secretCiphertext ?? null,
    enabled: true,
  }, ref.id);
  await ref.set(toDoc(row));
  return fromDoc<McpServer>(await ref.get());
}

export async function listMcpServers(db: Db, orgId: string): Promise<McpServer[]> {
  const snaps = await col(db, 'mcp_servers')
    .where('orgId', '==', orgId).where('enabled', '==', true).get();
  return snaps.map((d) => fromDoc<McpServer>(d));
}

export async function getMcpServer(db: Db, id: string): Promise<McpServer | undefined> {
  const snap = await col(db, 'mcp_servers').doc(id).get();
  return snap.exists ? fromDoc<McpServer>(snap) : undefined;
}

export async function setMcpServerEnabled(db: Db, id: string, enabled: boolean): Promise<void> {
  const ref = col(db, 'mcp_servers').doc(id);
  const snap = await ref.get();
  if (snap.exists) await ref.update(toDoc({ enabled }));
}

/** Decrypt a server's bearer token, or null if authType!=='bearer' / no secret. */
export function mcpServerToken(server: McpServer, key: Buffer): string | null {
  if (server.authType !== 'bearer' || !server.secretCiphertext) return null;
  return decryptSecret(server.secretCiphertext, key);
}
