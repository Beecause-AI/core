import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALG = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

/** Decodes a base64-encoded 32-byte key (e.g. SECRETS_KEY env var). The one place
 *  the key-encoding contract lives — always derive keys through this. */
export function keyFromBase64(encoded: string): Buffer {
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('key must decode to 32 bytes');
  return key;
}

/** Encrypts plaintext with AES-256-GCM. Output: base64(iv || tag || ciphertext). */
export function encryptSecret(plaintext: string, key: Buffer): string {
  if (key.length !== 32) throw new Error('key must be 32 bytes');
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

export function decryptSecret(encoded: string, key: Buffer): string {
  if (key.length !== 32) throw new Error('key must be 32 bytes');
  const buf = Buffer.from(encoded, 'base64');
  if (buf.length < IV_LEN + TAG_LEN) throw new Error('malformed ciphertext');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
