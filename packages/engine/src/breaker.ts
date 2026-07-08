import { ProviderError, type ErrorClass } from './provider.js';

// 'half_open' is part of the persisted enum/spec vocabulary, but this pure logic
// never *stores* it: the half-open probe is modeled implicitly by canAttempt()
// returning true once now >= nextProbeAt while state is still 'open'. A successful
// probe -> onSuccess() (closed); a failed probe -> onTemporaryFailure() (reopen,
// longer cooldown).
export type BreakerStateName = 'closed' | 'open' | 'half_open';

export interface Breaker {
  state: BreakerStateName;
  failures: number;
  openedAt: Date | null;
  nextProbeAt: Date | null;
}

export const FAILURE_THRESHOLD = 5;
/** Rate-limit (429) is an authoritative "back off now" signal, so the breaker trips far sooner
 *  than for generic transient errors — just enough to ride out a single stray 429. */
export const RATE_LIMIT_THRESHOLD = 2;
export const BASE_COOLDOWN_MS = 30_000;
export const MAX_COOLDOWN_MS = 10 * 60_000;

const TEMPORARY_STATUS = new Set([408, 425, 500, 502, 503, 504]);
const NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE']);

export function classifyError(err: unknown): ErrorClass {
  if (err instanceof ProviderError) return err.kind;
  if (err && typeof err === 'object') {
    const status = (err as { status?: number }).status;
    if (typeof status === 'number') {
      if (status === 429) return 'rate_limited';
      return TEMPORARY_STATUS.has(status) ? 'temporary' : 'permanent';
    }
    const code = (err as { code?: string }).code;
    if (typeof code === 'string' && NETWORK_CODES.has(code)) return 'temporary';
  }
  return 'permanent'; // unknown → fail fast, don't mask bugs as outages
}

function cooldownFor(failures: number): number {
  const over = Math.max(0, failures - FAILURE_THRESHOLD);
  return Math.min(MAX_COOLDOWN_MS, BASE_COOLDOWN_MS * 2 ** over);
}

/** True if a turn may be attempted now. Open breakers allow a single probe once
 *  nextProbeAt is reached (caller treats success/failure as half-open resolution). */
export function canAttempt(b: Breaker | null, now: Date): boolean {
  if (!b || b.state === 'closed') return true;
  if (b.nextProbeAt && now.getTime() >= b.nextProbeAt.getTime()) return true;
  return false;
}

export function onSuccess(_b: Breaker | null): Breaker {
  return { state: 'closed', failures: 0, openedAt: null, nextProbeAt: null };
}

export function onTemporaryFailure(b: Breaker | null, now: Date): Breaker {
  const failures = (b?.failures ?? 0) + 1;
  // `|| b.state === 'open'` keeps an already-open breaker open: a rate-limit open trips at the
  // lower RATE_LIMIT_THRESHOLD, so a subsequent generic failure (still under FAILURE_THRESHOLD)
  // must reopen, not silently close.
  if (failures >= FAILURE_THRESHOLD || b?.state === 'open') {
    return {
      state: 'open',
      failures,
      openedAt: now,
      nextProbeAt: new Date(now.getTime() + cooldownFor(failures)),
    };
  }
  return { state: 'closed', failures, openedAt: null, nextProbeAt: null };
}

/** A 429 rate-limit failure: trips at RATE_LIMIT_THRESHOLD and, when opening, honors the
 *  server-advised `retry-after` (clamped) as the cooldown instead of the exponential default. */
export function onRateLimit(b: Breaker | null, now: Date, retryAfterMs?: number): Breaker {
  const failures = (b?.failures ?? 0) + 1;
  if (failures >= RATE_LIMIT_THRESHOLD || b?.state === 'open') {
    const cooldown = retryAfterMs != null
      ? Math.min(MAX_COOLDOWN_MS, Math.max(1_000, retryAfterMs))
      : cooldownFor(failures);
    return { state: 'open', failures, openedAt: now, nextProbeAt: new Date(now.getTime() + cooldown) };
  }
  return { state: 'closed', failures, openedAt: null, nextProbeAt: null };
}
