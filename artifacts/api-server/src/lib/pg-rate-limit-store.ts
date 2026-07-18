/**
 * Persistent PostgreSQL-backed store for express-rate-limit.
 *
 * Each key (employeeId or IP) gets one row in `rate_limit_store`.
 * The row tracks the hit count and the window expiry time.
 * An UPSERT resets the window automatically once it has expired,
 * so no background cleanup job is required.
 *
 * Used only when NODE_ENV === "production".
 * The default in-memory store is retained for local development.
 */

import type { Store, IncrementResponse } from "express-rate-limit";

/** Minimal subset of pg.Pool that this store needs. */
interface QueryablePool {
  query<R extends object = object>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
}

export class PgRateLimitStore implements Store {
  constructor(
    private readonly pool: QueryablePool,
    private readonly windowMs: number,
  ) {}

  async increment(key: string): Promise<IncrementResponse> {
    const expiresAt = new Date(Date.now() + this.windowMs);

    const { rows } = await this.pool.query<{ hits: number; expires_at: Date }>(
      `
      INSERT INTO rate_limit_store (key, hits, expires_at)
      VALUES ($1, 1, $2)
      ON CONFLICT (key) DO UPDATE
        SET hits = CASE
              WHEN rate_limit_store.expires_at <= NOW() THEN 1
              ELSE rate_limit_store.hits + 1
            END,
            expires_at = CASE
              WHEN rate_limit_store.expires_at <= NOW() THEN $2
              ELSE rate_limit_store.expires_at
            END
      RETURNING hits, expires_at
      `,
      [key, expiresAt],
    );

    const row = rows[0]!;
    return { totalHits: row.hits, resetTime: row.expires_at };
  }

  async decrement(key: string): Promise<void> {
    await this.pool.query(
      `UPDATE rate_limit_store
          SET hits = GREATEST(hits - 1, 0)
        WHERE key = $1 AND expires_at > NOW()`,
      [key],
    );
  }

  async resetKey(key: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM rate_limit_store WHERE key = $1`,
      [key],
    );
  }

  async resetAll(): Promise<void> {
    await this.pool.query(`DELETE FROM rate_limit_store`);
  }
}
