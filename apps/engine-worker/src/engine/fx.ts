// apps/engine-worker/src/engine/fx.ts
import type { Db } from '@intellilabs/core';
import { readUsdEurRate, writeUsdEurRate } from '@intellilabs/billing';

let memo: { rate: number; date: string } | null = null;

function todayUtc(): string { return new Date().toISOString().slice(0, 10); }

/** Sync, memoized USD→EUR rate for hot-path debits. Returns `fallback` until a refresh lands. */
export function currentUsdEurRate(fallback: number): number {
  return memo && memo.date === todayUtc() ? memo.rate : fallback;
}

/** Best-effort daily refresh: Firestore cache → ECB fetch → leave fallback. Fire-and-forget. */
export async function refreshUsdEurRate(db: Db, fallback: number): Promise<void> {
  const today = todayUtc();
  if (memo?.date === today) return;
  try {
    const cached = await readUsdEurRate(db);
    if (cached?.date === today) { memo = { rate: cached.rate, date: today }; return; }
    const res = await fetch('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml');
    const xml = await res.text();
    const m = xml.match(/currency=['"]USD['"]\s+rate=['"]([\d.]+)['"]/);
    if (!m) throw new Error('no USD rate in ECB feed');
    const usdPerEur = parseFloat(m[1]!);           // ECB base is EUR: 1 EUR = usdPerEur USD
    if (!(usdPerEur > 0)) throw new Error('bad ECB rate');
    const rate = 1 / usdPerEur;                     // USD → EUR
    memo = { rate, date: today };
    await writeUsdEurRate(db, { rate, date: today, source: 'ecb' }).catch(() => { /* cache is best-effort */ });
  } catch {
    if (!memo) memo = { rate: fallback, date: today };
  }
}
