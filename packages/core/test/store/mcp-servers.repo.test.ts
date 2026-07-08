import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { testStore, wipe } from './emulator.js';
import {
  createMcpServer, listMcpServers, getMcpServer, setMcpServerEnabled, mcpServerToken,
} from '../../src/repos/mcp-servers.js';
import { encryptSecret, keyFromBase64 } from '../../src/crypto/secrets.js';

const store = testStore('mcp-servers');
const db = store.db;
const key = keyFromBase64(Buffer.alloc(32).toString('base64'));
const orgId = 'org1';

beforeEach(() => wipe(db));
afterAll(() => store.close());

describe('mcp-servers repo (Firestore)', () => {
  it('creates with defaults and lists enabled servers', async () => {
    await createMcpServer(db, { orgId, name: 'server-a', url: 'https://a.example.com/mcp' });
    await createMcpServer(db, { orgId, name: 'server-b', url: 'https://b.example.com/mcp' });
    const names = (await listMcpServers(db, orgId)).map((s) => s.name);
    expect(names).toContain('server-a');
    expect(names).toContain('server-b');
  });

  it('getMcpServer round-trips and returns undefined for unknown id', async () => {
    const created = await createMcpServer(db, { orgId, name: 'rt', url: 'https://rt.example.com/mcp' });
    const fetched = await getMcpServer(db, created.id);
    expect(fetched).not.toBeUndefined();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.name).toBe('rt');
    expect(fetched!.authType).toBe('none');
    expect(fetched!.enabled).toBe(true);
    expect(await getMcpServer(db, 'no-such-id')).toBeUndefined();
  });

  it('disabling a server removes it from listMcpServers', async () => {
    const c = await createMcpServer(db, { orgId, name: 'server-c', url: 'https://c.example.com/mcp' });
    await createMcpServer(db, { orgId, name: 'server-d', url: 'https://d.example.com/mcp' });
    await setMcpServerEnabled(db, c.id, false);
    const after = (await listMcpServers(db, orgId)).map((s) => s.name);
    expect(after).not.toContain('server-c');
    expect(after).toContain('server-d');
  });

  it('mcpServerToken decrypts bearer / returns null otherwise', async () => {
    const ciphertext = encryptSecret('tok', key);
    const bearer = await createMcpServer(db, {
      orgId, name: 'bearer', url: 'https://b.example.com/mcp', authType: 'bearer', secretCiphertext: ciphertext,
    });
    expect(mcpServerToken((await getMcpServer(db, bearer.id))!, key)).toBe('tok');
    const none = await createMcpServer(db, { orgId, name: 'none', url: 'https://n.example.com/mcp', authType: 'none' });
    expect(mcpServerToken((await getMcpServer(db, none.id))!, key)).toBeNull();
  });

  it('rejects a duplicate name for the same org (23505)', async () => {
    await createMcpServer(db, { orgId, name: 'uniq', url: 'https://u.example.com/mcp' });
    let err: unknown;
    try { await createMcpServer(db, { orgId, name: 'uniq', url: 'https://u2.example.com/mcp' }); } catch (e) { err = e; }
    expect((err as { code?: string })?.code).toBe('23505');
  });
});
