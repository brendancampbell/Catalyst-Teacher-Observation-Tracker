/**
 * Simple in-process TTL cache.
 *
 * Each route module that benefits from caching creates its own singleton
 * instance.  Expired entries are lazily evicted on get() and eagerly swept
 * by the optional background interval (if enabled at construction time).
 */
export class TtlCache<T> {
  private readonly store = new Map<string, { value: T; expiresAt: number }>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * @param ttlMs     How long (ms) a cached value remains valid.
   * @param sweepMs   Optional background sweep interval to prune expired
   *                  entries from memory.  Pass 0 (default) to skip.
   */
  constructor(private readonly ttlMs: number, sweepMs = 0) {
    if (sweepMs > 0) {
      this.sweepTimer = setInterval(() => this.sweep(), sweepMs).unref();
    }
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  /** Removes every entry whose key starts with `prefix`. */
  invalidatePrefix(prefix: string): void {
    for (const k of this.store.keys()) {
      if (k.startsWith(prefix)) this.store.delete(k);
    }
  }

  /** Removes all entries whose key contains `fragment`. */
  invalidateContaining(fragment: string): void {
    for (const k of this.store.keys()) {
      if (k.includes(fragment)) this.store.delete(k);
    }
  }

  /** Number of non-expired entries currently stored. */
  size(): number {
    const now = Date.now();
    let n = 0;
    for (const e of this.store.values()) if (e.expiresAt > now) n++;
    return n;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [k, e] of this.store) if (e.expiresAt <= now) this.store.delete(k);
  }

  destroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.store.clear();
  }
}
