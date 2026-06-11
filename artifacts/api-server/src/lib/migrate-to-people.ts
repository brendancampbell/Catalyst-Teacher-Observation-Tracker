/**
 * One-time cleanup: remove legacy teachers/users tables and old integer FK
 * columns from observations. Schools and rubric data are untouched.
 *
 * Idempotent: safe to call on every startup; exits immediately when already done.
 *
 * Note: teachers and users are defined in the Drizzle legacy-tables schema so
 * Replit's publish migration does NOT generate DROP TABLE CASCADE (which would
 * silently remove FK constraints before the explicit DROP CONSTRAINT statements,
 * causing migration failures). This startup migration handles the actual cleanup.
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";

async function tableExists(client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }, table: string): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [table],
  );
  return (rows[0] as { exists: boolean }).exists ?? false;
}

async function columnExists(client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }, table: string, column: string): Promise<boolean> {
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
    const teachersTableExists = await tableExists(client, "teachers");
    const usersTableExists    = await tableExists(client, "users");
    const teacherColExists    = await columnExists(client, "observations", "teacher_id");
    const observerColExists   = await columnExists(client, "observations", "observer_id");
    const editedByColExists   = await columnExists(client, "observations", "edited_by_id");

    const alreadyDone =
      !teachersTableExists &&
      !usersTableExists &&
      !teacherColExists &&
      !observerColExists &&
      !editedByColExists;

    if (alreadyDone) {
      logger.info("[migrate-to-people] Already complete — skipping");
      return;
    }

    logger.info(
      { teachersTableExists, usersTableExists, teacherColExists, observerColExists, editedByColExists },
      "[migrate-to-people] Cleaning up legacy schema artifacts",
    );

    /* Drop legacy tables with CASCADE to handle any remaining FK constraints.
       CASCADE only removes the FK constraint objects — it does NOT delete rows
       from the observations table. Observation data is not touched here.      */
    if (teachersTableExists) {
      await client.query(`DROP TABLE IF EXISTS teachers CASCADE`);
      logger.info("[migrate-to-people] Dropped teachers table");
    }

    if (usersTableExists) {
      await client.query(`DROP TABLE IF EXISTS users CASCADE`);
      logger.info("[migrate-to-people] Dropped users table");
    }

    /* Safety net: drop any legacy integer FK columns that Replit's schema
       migration may not have removed yet (safe no-op when already absent). */
    const legacyCols = [
      teacherColExists  && "teacher_id",
      observerColExists && "observer_id",
      editedByColExists && "edited_by_id",
    ].filter(Boolean) as string[];

    if (legacyCols.length > 0) {
      const dropClauses = legacyCols.map(c => `DROP COLUMN IF EXISTS ${c}`).join(", ");
      await client.query(`ALTER TABLE observations ${dropClauses}`);
      logger.info({ dropped: legacyCols }, "[migrate-to-people] Dropped legacy observation columns");
    }

    logger.info("[migrate-to-people] Migration complete ✓");
  } catch (err) {
    logger.error({ err }, "[migrate-to-people] Migration FAILED");
    throw err;
  } finally {
    client.release();
  }
}
