/**
 * One-time safety-net: drop any legacy integer FK columns that may remain on the
 * observations table from before the people-based schema migration. In practice
 * Replit's publish migration removes them, so this is a no-op after the first
 * successful deploy.
 *
 * Idempotent: safe to call on every startup; exits immediately when already done.
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";

async function columnExists(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  table: string,
  column: string,
): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     ) AS exists`,
    [table, column],
  );
  return (rows[0] as { exists: boolean }).exists ?? false;
}

export async function runPeopleMigration(): Promise<void> {
  const client = await pool.connect();
  try {
    const teacherColExists  = await columnExists(client, "observations", "teacher_id");
    const observerColExists = await columnExists(client, "observations", "observer_id");
    const editedByColExists = await columnExists(client, "observations", "edited_by_id");

    if (!teacherColExists && !observerColExists && !editedByColExists) {
      logger.info("[migrate-to-people] Already complete — skipping");
      return;
    }

    const legacyCols = [
      teacherColExists  && "teacher_id",
      observerColExists && "observer_id",
      editedByColExists && "edited_by_id",
    ].filter(Boolean) as string[];

    const dropClauses = legacyCols.map(c => `DROP COLUMN IF EXISTS ${c}`).join(", ");
    await client.query(`ALTER TABLE observations ${dropClauses}`);
    logger.info({ dropped: legacyCols }, "[migrate-to-people] Dropped legacy observation columns ✓");
  } catch (err) {
    logger.error({ err }, "[migrate-to-people] Migration FAILED");
    throw err;
  } finally {
    client.release();
  }
}
