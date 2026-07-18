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
 * Returns { consumed: true, grantId } if a grant slot was used,
 * or { consumed: false, grantId: null } if no valid grant exists.
 */
export async function checkAndConsumeQuotaGrant(
  employeeId: string,
  type: QuotaGrantType,
): Promise<QuotaConsumeResult> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ id: number; used_requests: number; extra_requests: number }>(
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
        RETURNING id, used_requests, extra_requests`,
      [employeeId, type],
    );
    if (rows.length === 0) return { consumed: false, grantId: null };
    return { consumed: true, grantId: rows[0].id };
  } finally {
    client.release();
  }
}
