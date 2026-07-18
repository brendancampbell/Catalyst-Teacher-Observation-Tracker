import { pool } from "@workspace/db";

export type QuotaGrantType = "chat" | "generation";

export interface QuotaConsumeResult {
  consumed: boolean;
  grantId:  number | null;
}

/**
 * Called only when a user has already exceeded their normal rate limit.
 * Finds the oldest unexpired, non-exhausted quota grant for the user
 * and atomically increments used_requests by 1.
 *
 * Uses SELECT … FOR UPDATE SKIP LOCKED inside a CTE so that two concurrent
 * callers cannot both pick up the same candidate row: the second caller
 * skips the locked row, finds nothing, and returns { consumed: false }.
 *
 * Returns { consumed: true, grantId } if a grant slot was used,
 * or { consumed: false, grantId: null } if no valid grant exists.
 */
export async function checkAndConsumeQuotaGrant(
  employeeId: string,
  type: QuotaGrantType,
): Promise<QuotaConsumeResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: number; used_requests: number; extra_requests: number }>(
      `WITH candidate AS (
          SELECT id
            FROM ai_quota_grants
           WHERE employee_id = $1
             AND (grant_type = $2 OR grant_type = 'all')
             AND expires_at > NOW()
             AND used_requests < extra_requests
           ORDER BY expires_at ASC
           LIMIT 1
           FOR UPDATE SKIP LOCKED
       )
       UPDATE ai_quota_grants
          SET used_requests = used_requests + 1
         FROM candidate
        WHERE ai_quota_grants.id = candidate.id
          AND ai_quota_grants.used_requests < ai_quota_grants.extra_requests
       RETURNING ai_quota_grants.id, ai_quota_grants.used_requests, ai_quota_grants.extra_requests`,
      [employeeId, type],
    );
    await client.query("COMMIT");
    if (rows.length === 0) return { consumed: false, grantId: null };
    return { consumed: true, grantId: rows[0].id };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
