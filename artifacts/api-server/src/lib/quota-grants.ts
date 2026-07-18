import { pool } from "@workspace/db";

export type QuotaGrantType = "chat" | "generation";

/**
 * Checks whether the given user has an active, non-exhausted quota grant
 * for the specified type (or a grant with type='all').
 *
 * If a valid grant is found, it atomically increments used_requests and
 * returns true (the rate limiter should skip / not count the request).
 */
export async function checkAndConsumeQuotaGrant(
  employeeId: string,
  type: QuotaGrantType,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ id: number }>(
      `UPDATE ai_quota_grants
          SET used_requests = used_requests + 1
        WHERE id = (
          SELECT id
            FROM ai_quota_grants
           WHERE employee_id = $1
             AND (grant_type = $2 OR grant_type = 'all')
             AND expires_at > NOW()
             AND used_requests < extra_requests
           ORDER BY expires_at ASC
           LIMIT 1
        )
        RETURNING id`,
      [employeeId, type],
    );
    return rows.length > 0;
  } finally {
    client.release();
  }
}
