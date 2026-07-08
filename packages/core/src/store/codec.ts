import { FieldValue, type DocData, type Snapshot } from '../ports/store.js';

/** Apply defaults: generated id + createdAt=now when absent. */
export function applyDefaults<T extends Record<string, any>>(
  v: T,
  id: string,
): T & { id: string; createdAt: Date } {
  return { createdAt: new Date(), ...v, id: v.id ?? id };
}

/** Domain row → write payload: drop `undefined` (preserve `null`); Date/FieldValue pass through. */
export function toDoc<T extends Record<string, any>>(row: T): DocData {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(row)) {
    if (val === undefined) continue;
    out[k] = val;
  }
  return out;
}

/** Port Snapshot → domain row: inject id. Date normalization is the adapter's job (Snapshot.data()). */
export function fromDoc<T = any>(snap: Snapshot): T {
  return { id: snap.id, ...(snap.data() ?? {}) } as T;
}

export { FieldValue };
