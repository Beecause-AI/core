/**
 * In-process token bucket, keyed by client IP. Per-Cloud-Run-instance only
 * (accepted in the spec); a Cloudflare rate-limiting rule is the later
 * global hardening. Buckets are pruned lazily to bound memory.
 */
export class TokenBucketLimiter {
  private buckets = new Map<string, { tokens: number; updatedAt: number }>();

  constructor(
    private readonly opts: { capacity: number; refillPerMs: number; now?: () => number },
  ) {}

  tryConsume(key: string): boolean {
    const now = (this.opts.now ?? Date.now)();
    const b = this.buckets.get(key) ?? { tokens: this.opts.capacity, updatedAt: now };
    b.tokens = Math.min(this.opts.capacity, b.tokens + (now - b.updatedAt) * this.opts.refillPerMs);
    b.updatedAt = now;
    if (b.tokens < 1) {
      this.buckets.set(key, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.set(key, b);
    if (this.buckets.size > 10_000) this.prune(now);
    return true;
  }

  private prune(now: number): void {
    for (const [k, b] of this.buckets) {
      if (b.tokens >= this.opts.capacity || now - b.updatedAt > 600_000) this.buckets.delete(k);
    }
  }
}
