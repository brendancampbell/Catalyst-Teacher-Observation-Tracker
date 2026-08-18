import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { bootstrapAdmin } from "./lib/bootstrap-admin";
import { cleanupExpiredQuotaGrants } from "./lib/quota-grant-cleanup.js";
import { markReady } from "./lib/readiness";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function ensureSessionTable(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "sid"    varchar      NOT NULL COLLATE "default",
        "sess"   json         NOT NULL,
        "expire" timestamp(6) NOT NULL,
        CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
      );
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
    `);
    logger.info("Session table ready");
  } finally {
    client.release();
  }
}

async function ensureChatTables(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id          SERIAL PRIMARY KEY,
        employee_id TEXT NOT NULL REFERENCES people(employee_id) ON DELETE CASCADE,
        title       TEXT NOT NULL DEFAULT 'New Chat',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS chat_sessions_employee_id_idx ON chat_sessions(employee_id);
      CREATE INDEX IF NOT EXISTS chat_sessions_updated_at_idx  ON chat_sessions(updated_at DESC);
      CREATE TABLE IF NOT EXISTS chat_messages (
        id         SERIAL PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role       TEXT NOT NULL,
        content    TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS chat_messages_session_id_idx ON chat_messages(session_id);
    `);
    /* Add rubric_set_slug column if not yet present (idempotent) */
    await client.query(`
      ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS rubric_set_slug TEXT;
    `);
    /* Add instant_analysis_structured column if not yet present (idempotent) */
    await client.query(`
      ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS instant_analysis_structured JSONB;
    `);
    logger.info("Chat tables ready");
  } finally {
    client.release();
  }
}

/* ── Backfill school_year_id on any NULL rows, then enforce NOT NULL ─────────
   Fill data first, then tighten the constraint so the ALTER never runs
   against a table that still has NULLs.
   Safe to run multiple times — every UPDATE is filtered on IS NULL,
   and SET NOT NULL is idempotent once the column is already constrained. */
async function ensureSchoolYearIds(): Promise<void> {
  const client = await pool.connect();
  try {
    /* ── Resolve the school year ids we need ─────────────────────── */
    const { rows: yearRows } = await client.query<{ id: number }>(
      `SELECT id FROM school_years WHERE name = '2025-2026' LIMIT 1`,
    );
    if (yearRows.length === 0) {
      logger.warn(
        "ensureSchoolYearIds: no '2025-2026' school_year row found — skipping backfill.",
      );
      return;
    }
    const year2526Id = yearRows[0].id;

    const { rows: activeYearRows } = await client.query<{ id: number }>(
      `SELECT id FROM school_years WHERE status = 'active' ORDER BY display_order DESC LIMIT 1`,
    );
    const activeYearId: number =
      activeYearRows.length > 0 ? activeYearRows[0].id : year2526Id;

    /* ── 1. Backfill rubric_sets ──────────────────────────────────── */
    const { rowCount: rsCount } = await client.query(
      `UPDATE rubric_sets SET school_year_id = $1 WHERE school_year_id IS NULL`,
      [year2526Id],
    );
    if ((rsCount ?? 0) > 0) logger.info(`ensureSchoolYearIds: rubric_sets backfilled ${rsCount} rows.`);

    /* ── 2. Backfill rubric_domains ───────────────────────────────── */
    const { rowCount: rdCount } = await client.query(
      `UPDATE rubric_domains SET school_year_id = $1 WHERE school_year_id IS NULL`,
      [year2526Id],
    );
    if ((rdCount ?? 0) > 0) logger.info(`ensureSchoolYearIds: rubric_domains backfilled ${rdCount} rows.`);

    /* ── 3. Backfill observations (prefer rubric_set join, fall back to active year) ── */
    const { rowCount: obsCount1 } = await client.query(`
      UPDATE observations o
      SET school_year_id = rs.school_year_id
      FROM rubric_sets rs
      WHERE o.rubric_set_id = rs.id
        AND o.school_year_id IS NULL
        AND rs.school_year_id IS NOT NULL
    `);
    if ((obsCount1 ?? 0) > 0) logger.info(`ensureSchoolYearIds: observations backfilled ${obsCount1} rows via rubric_set join.`);

    const { rowCount: obsCount2 } = await client.query(
      `UPDATE observations SET school_year_id = $1 WHERE school_year_id IS NULL`,
      [activeYearId],
    );
    if ((obsCount2 ?? 0) > 0) logger.info(`ensureSchoolYearIds: observations backfilled ${obsCount2} additional rows via active year.`);

    /* ── 4. Backfill action_steps (prefer observation join, fall back to active year) ── */
    const { rowCount: asCount1 } = await client.query(`
      UPDATE action_steps a
      SET school_year_id = o.school_year_id
      FROM observations o
      WHERE a.assigned_during_observation_id = o.id
        AND a.school_year_id IS NULL
        AND o.school_year_id IS NOT NULL
    `);
    if ((asCount1 ?? 0) > 0) logger.info(`ensureSchoolYearIds: action_steps backfilled ${asCount1} rows via observation join.`);

    const { rowCount: asCount2 } = await client.query(
      `UPDATE action_steps SET school_year_id = $1 WHERE school_year_id IS NULL`,
      [activeYearId],
    );
    if ((asCount2 ?? 0) > 0) logger.info(`ensureSchoolYearIds: action_steps backfilled ${asCount2} additional rows via active year.`);

    /* ── 5. Enforce NOT NULL on all four columns ──────────────────── */
    await client.query(`
      ALTER TABLE rubric_sets    ALTER COLUMN school_year_id SET NOT NULL;
      ALTER TABLE rubric_domains ALTER COLUMN school_year_id SET NOT NULL;
      ALTER TABLE observations   ALTER COLUMN school_year_id SET NOT NULL;
      ALTER TABLE action_steps   ALTER COLUMN school_year_id SET NOT NULL;
    `);

    logger.info("ensureSchoolYearIds: all school_year_id columns are NOT NULL.");
  } finally {
    client.release();
  }
}

/* ── Periodic cleanup: delete quota grant rows expired > 7 days ago ──────────
   Runs once at startup and then every hour. Uses .unref() so the interval
   never prevents a clean process exit.
   Implementation lives in ./lib/quota-grant-cleanup (exported for testing). */
const QUOTA_GRANT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; /* 1 hour */
/* cleanupExpiredQuotaGrants is imported from ./lib/quota-grant-cleanup */

async function ensureSchoolYears(): Promise<void> {
  const client = await pool.connect();
  try {
    /* ── Seed the initial row if the table is empty ────────────────── */
    const { rows } = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM school_years`,
    );
    if (Number(rows[0].count) === 0) {
      logger.info("School years table empty — seeding initial row");
      await client.query(
        `INSERT INTO school_years (name, status) VALUES ('2025-2026', 'active')`,
      );
      logger.info("School years seeded: 2025-2026 (active)");
    } else {
      logger.info("School years already seeded — skipping");
    }

    /* ── Mirror of 0004_school_years_display_order.sql UPDATE ─────────
       Migration 0004 populates display_order using ROW_NUMBER(), but
       drizzle-kit push skips migration files entirely.  Any environment
       that was bootstrapped with push ends up with display_order = 0
       on every row (the column default).  Detect that state — all rows
       at zero with more than one row present — and apply the same
       ordering logic idempotently.

       The condition "NOT EXISTS (... WHERE display_order != 0)" is a
       reliable indicator: the only way all rows stay at 0 is if the
       migration UPDATE never ran, because any API reorder sets distinct
       non-zero values on at least one row.                             */
    const { rows: fixRows } = await client.query<{ needs_fix: boolean }>(`
      SELECT (
        (SELECT COUNT(*) FROM school_years) > 1
        AND NOT EXISTS (SELECT 1 FROM school_years WHERE display_order != 0)
      ) AS needs_fix
    `);
    if (fixRows[0].needs_fix) {
      await client.query(`
        UPDATE school_years
        SET display_order = sub.rn
        FROM (
          SELECT id, (ROW_NUMBER() OVER (ORDER BY id DESC) - 1)::int AS rn
          FROM school_years
        ) sub
        WHERE school_years.id = sub.id
      `);
      logger.info("School years: display_order populated via startup mirror (0004 migration data UPDATE was skipped)");
    }
  } finally {
    client.release();
  }
}

async function ensureSchoolYearBackfill(): Promise<void> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ id: number }>(
      `SELECT id FROM school_years WHERE status = 'active' LIMIT 1`,
    );
    if (!rows[0]) {
      logger.warn("ensureSchoolYearBackfill: no active school year found — skipping");
      return;
    }
    const activeId = rows[0].id;

    /* ── Fix incorrect unique index on rubric_domains ─────────────────────────
       The original index (school_year_id, slug) is wrong: the same domain slug
       can legitimately appear in multiple rubric sets within the same school year.
       Replace it with (school_year_id, rubric_set_id, slug) before backfilling,
       otherwise the bulk UPDATE would violate the old constraint and crash startup. */
    const { rows: oldIdxRows } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM pg_indexes
         WHERE tablename = 'rubric_domains'
           AND indexname  = 'rubric_domains_year_slug_uniq'
       ) AS exists`,
    );
    if (oldIdxRows[0].exists) {
      await client.query(`DROP INDEX rubric_domains_year_slug_uniq`);
      logger.info("School year backfill: dropped rubric_domains_year_slug_uniq (incorrect columns)");
    }
    const { rows: newIdxRows } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM pg_indexes
         WHERE tablename = 'rubric_domains'
           AND indexname  = 'rubric_domains_year_set_slug_uniq'
       ) AS exists`,
    );
    if (!newIdxRows[0].exists) {
      await client.query(
        `CREATE UNIQUE INDEX rubric_domains_year_set_slug_uniq
           ON rubric_domains (school_year_id, rubric_set_id, slug)`,
      );
      logger.info("School year backfill: created rubric_domains_year_set_slug_uniq");
    }

    const tables = ["rubric_sets", "rubric_domains", "observations", "action_steps"] as const;
    for (const table of tables) {
      const { rowCount } = await client.query(
        `UPDATE ${table} SET school_year_id = $1 WHERE school_year_id IS NULL`,
        [activeId],
      );
      if (rowCount && rowCount > 0) {
        logger.info(`School year backfill: set ${rowCount} ${table} rows → year ${activeId}`);
      }
    }
  } finally {
    client.release();
  }
}

/* ── Start listening immediately so the deployment healthcheck passes
   during the startup window. Startup tasks (migrations, seeding) run
   in the background and complete within a few seconds in production.
   If any startup task fails we log and exit so the platform retries.

   Binding early does NOT mean serving early: a readiness gate in app.ts
   returns 503 for everything except /api/healthz until markReady() is
   called below, so no request is handled while the startup tasks are
   still altering the schema underneath it.                            */
app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
});

ensureSessionTable()
  .then(() => ensureSchoolYears())
  .then(() => ensureSchoolYearBackfill())
  .then(() => ensureChatTables())
  .then(() => ensureSchoolYearIds())
  .then(() => bootstrapAdmin())
  .then(() => {
    /* Startup complete — begin serving normal traffic. */
    markReady();
    logger.info("Startup tasks complete — now accepting requests");

    /* Kick off first cleanup immediately, then repeat every hour */
    cleanupExpiredQuotaGrants().catch((err) =>
      logger.warn({ err, event: "quota_grant_cleanup_failed" }, "Quota grant cleanup failed"),
    );
    setInterval(() => {
      cleanupExpiredQuotaGrants().catch((err) =>
        logger.warn({ err, event: "quota_grant_cleanup_failed" }, "Quota grant cleanup failed"),
      );
    }, QUOTA_GRANT_CLEANUP_INTERVAL_MS).unref();
  })
  .catch((err) => {
    logger.error({ err }, "Startup tasks failed — aborting");
    process.exit(1);
  });
