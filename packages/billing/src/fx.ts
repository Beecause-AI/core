// OSS no-op stub for FX rates.
// In the managed SaaS, this reads/writes ECB USD/EUR rates to Firestore for credit billing.
// In the OSS self-hosted build, FX rates are not used.
import type { Db } from '@intellilabs/core';

export interface UsdEurRate { rate: number; date: string; source: string }

/** No-op in OSS build: no FX rate stored. */
export async function readUsdEurRate(_db: Db): Promise<UsdEurRate | null> {
  return null;
}

/** No-op in OSS build. */
export async function writeUsdEurRate(_db: Db, _r: UsdEurRate): Promise<void> {
  // no-op
}
