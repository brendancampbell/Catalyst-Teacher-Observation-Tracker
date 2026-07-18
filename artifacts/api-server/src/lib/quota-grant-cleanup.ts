import { pool } from "@workspace/db";
import { logger } from "./logger.js";

export const QUOTA_GRANT_GRACE_INTERVAL = "7 days";

export async function cleanupExpiredQuotaGrants(): Promise<void> {
  const client = await pool.connect();
  try {
    const { rowCount } = await client.query(
      `DELETE FROM ai_quota_grants
        WHERE expires_at < NOW() - INTERVAL '${QUOTA_GRANT_GRACE_INTERVAL}'`,
    );
    if (rowCount && rowCount > 0) {
      logger.info(
        { deletedCount: rowCount, event: "quota_grant_cleanup" },
        "Expired quota grants cleaned up",
      );
    }
  } finally {
    client.release();
  }
}
