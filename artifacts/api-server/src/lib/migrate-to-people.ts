/**
 * One-time migration: merge users + teachers → people table, update observations FKs.
 *
 * PHASE-AWARE IDEMPOTENCY:
 *   The migration is split into three independently resumable phases.
 *   Each phase checks its own completion markers before running.
 *
 *   Phase A — Create people table + seed from teachers/users  (marker: people table exists)
 *   Phase B — Add text FKs to observations, backfill, validate, drop old int FK columns
 *             (marker: observations.teacher_id column absent)
 *   Phase C — Drop legacy tables  (marker: teachers + users tables absent)
 *
 *   A run where `people` exists but legacy artifacts remain will resume from
 *   Phase B / Phase C rather than silently returning.
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";

interface QueryClient {
  query<R extends Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
  query(text: string): Promise<{ rows: Record<string, unknown>[] }>;
}

async function columnExists(client: QueryClient, table: string, column: string): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     ) AS exists`,
    [table, column],
  );
  return rows[0]?.exists ?? false;
}

async function tableExists(client: QueryClient, table: string): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [table],
  );
  return rows[0]?.exists ?? false;
}

export async function runPeopleMigration(): Promise<void> {
  const client = await pool.connect();
  try {
    /* ── Read current migration state ────────────────────────────── */
    const peopleTableExists   = await tableExists(client, "people");
    const teacherColExists    = await columnExists(client, "observations", "teacher_id");
    const teachersTableExists = await tableExists(client, "teachers");
    const usersTableExists    = await tableExists(client, "users");

    /* Detect the case where Replit's schema migration created the people table
       but left it empty (schema applied before server startup).               */
    let peopleNeedsSeeding = false;
    if (peopleTableExists && (teachersTableExists || usersTableExists)) {
      const { rows: cntRows } = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM people`,
      );
      peopleNeedsSeeding = cntRows[0].count === "0";
    }

    /* ── Already fully complete ──────────────────────────────────── */
    if (peopleTableExists && !peopleNeedsSeeding && !teacherColExists && !teachersTableExists && !usersTableExists) {
      logger.info("[migrate-to-people] Migration already complete — skipping");
      return;
    }

    logger.info(
      { peopleTableExists, teacherColExists, teachersTableExists, usersTableExists },
      "[migrate-to-people] Starting/resuming migration",
    );

    /* ══ PHASE A: Create people table + seed from teachers/users ═══
       Runs when people table does not exist yet, OR when it was created
       externally (e.g. Replit schema migration) but left empty.         */
    if (!peopleTableExists || peopleNeedsSeeding) {
      logger.info(
        peopleNeedsSeeding
          ? "[migrate-to-people] Phase A: people table exists but is empty — seeding from teachers/users"
          : "[migrate-to-people] Phase A: creating people table and seeding data",
      );
      await client.query("BEGIN");
      try {
        /* 1. Create enums (always idempotent) */
        await client.query(`
          DO $$ BEGIN
            CREATE TYPE person_role AS ENUM (
              'COACH', 'SCHOOL_LEADER', 'NETWORK_LEADER', 'NETWORK_ADMIN', 'NO_ACCESS'
            );
          EXCEPTION WHEN duplicate_object THEN NULL;
          END $$;
        `);
        await client.query(`
          DO $$ BEGIN
            CREATE TYPE department_enum AS ENUM (
              'English', 'Math', 'Science', 'History', 'Spanish',
              'Physical Education', 'Comp Sci/Engineering', 'Visual Arts', 'College', 'Other'
            );
          EXCEPTION WHEN duplicate_object THEN NULL;
          END $$;
        `);

        /* 2. Create people table — only when it doesn't already exist
           (when peopleNeedsSeeding is true the table was created by Replit) */
        if (!peopleTableExists) {
          await client.query(`
            CREATE TABLE people (
              employee_id                   text PRIMARY KEY,
              first_name                    text NOT NULL,
              last_name                     text NOT NULL,
              email                         text NOT NULL UNIQUE,
              google_id                     text UNIQUE,
              role                          person_role NOT NULL DEFAULT 'NO_ACCESS',
              is_active                     boolean NOT NULL DEFAULT true,
              include_in_feedback_tracker   boolean NOT NULL DEFAULT false,
              school_id                     integer REFERENCES schools(id) ON DELETE SET NULL,
              primary_instructional_leader_id text,
              department                    department_enum,
              grade_level                   text[],
              needs_rescore                 boolean NOT NULL DEFAULT false,
              rescore_due_date              date
            )
          `);
        }

        /* 3. Migrate teachers → people */
        await client.query(`
          INSERT INTO people (
            employee_id, first_name, last_name, email, google_id, role,
            is_active, include_in_feedback_tracker, school_id,
            department, grade_level, needs_rescore, rescore_due_date
          )
          SELECT
            COALESCE(NULLIF(TRIM(t.employee_id), ''), 'T' || t.id::text) AS employee_id,
            COALESCE(NULLIF(TRIM(t.first_name), ''), 'Unknown') AS first_name,
            COALESCE(t.last_name, '') AS last_name,
            LOWER(TRIM(t.email)) AS email,
            NULL AS google_id,
            'NO_ACCESS'::person_role AS role,
            t.is_active,
            true AS include_in_feedback_tracker,
            t.school_id,
            CASE
              WHEN t.subject IN ('English','Math','Science','History','Spanish',
                'Physical Education','Comp Sci/Engineering','Visual Arts','College','Other')
              THEN t.subject::department_enum
              ELSE NULL
            END AS department,
            t.grade_level,
            t.needs_rescore,
            t.rescore_due_date
          FROM teachers t
          WHERE t.email IS NOT NULL AND TRIM(t.email) <> ''
          ON CONFLICT (email) DO NOTHING
        `);

        /* 4. Migrate users → people (warn+skip on email conflict)
           When a user's email already exists (seeded from teachers), we
           skip rather than overwrite the existing record to avoid losing
           teacher-derived data.  The person retains the teacher's employee_id,
           and Phase B backfills observer FKs via email join (not synthetic ids). */
        const { rows: userInsertResult } = await client.query<{ inserted: string; total: string }>(`
          WITH inserted AS (
            INSERT INTO people (
              employee_id, first_name, last_name, email, google_id, role,
              is_active, include_in_feedback_tracker, school_id
            )
            SELECT
              'U' || u.id::text AS employee_id,
              SPLIT_PART(u.name, ' ', 1) AS first_name,
              CASE
                WHEN POSITION(' ' IN u.name) > 0
                  THEN TRIM(SUBSTRING(u.name FROM POSITION(' ' IN u.name) + 1))
                ELSE ''
              END AS last_name,
              LOWER(TRIM(u.email)) AS email,
              u.google_id,
              u.role::text::person_role AS role,
              u.is_active,
              false AS include_in_feedback_tracker,
              u.school_id
            FROM users u
            ON CONFLICT (email) DO NOTHING
            RETURNING employee_id
          )
          SELECT
            COUNT(*)::text AS inserted,
            (SELECT COUNT(*) FROM users)::text AS total
          FROM inserted
        `);
        const insertedUsers = parseInt(userInsertResult[0]?.inserted ?? "0", 10);
        const totalUsers   = parseInt(userInsertResult[0]?.total   ?? "0", 10);
        const skippedUsers = totalUsers - insertedUsers;

        /* 4b. Merge user auth attributes into teacher-seeded records where emails overlap.
           Teacher-seeded records start with role=NO_ACCESS and google_id=NULL.
           Any user sharing the email must get their staff role + google_id so they
           can authenticate — the ON CONFLICT DO NOTHING above only skips the INSERT
           of a duplicate row; this UPDATE ensures the existing record is correct.   */
        const { rowCount: mergedCount } = await client.query(`
          UPDATE people p
          SET
            role      = u.role::text::person_role,
            google_id = COALESCE(p.google_id, u.google_id),
            is_active = u.is_active,
            school_id = COALESCE(p.school_id, u.school_id)
          FROM users u
          WHERE LOWER(TRIM(u.email)) = p.email
        `);

        if (skippedUsers > 0) {
          logger.warn(
            {
              inserted: insertedUsers,
              total:    totalUsers,
              skipped:  skippedUsers,
              merged:   mergedCount ?? 0,
            },
            "[migrate-to-people] Some user rows had email conflicts with teacher-seeded people. " +
            "No duplicate people created — existing records updated with user role + google_id " +
            "so those people can authenticate with their staff role.",
          );
        }

        /* 4c. Post-conflict report: log final role/google_id for all email-conflicted records */
        const { rows: conflictReport } = await client.query<{
          email: string; role: string; has_google_id: boolean;
        }>(`
          SELECT p.email, p.role, (p.google_id IS NOT NULL) AS has_google_id
          FROM people p
          JOIN users u ON LOWER(TRIM(u.email)) = p.email
          WHERE p.include_in_feedback_tracker = true
          ORDER BY p.email
        `);
        if (conflictReport.length > 0) {
          logger.info(
            { conflicts: conflictReport },
            "[migrate-to-people] Email-overlap records after merge (teacher+user on same email)",
          );
        }

        /* 5. Add self-referencing FK on people — idempotent in case Replit's
           schema migration already created it alongside the table.           */
        await client.query(`
          DO $$ BEGIN
            ALTER TABLE people
              ADD CONSTRAINT people_pil_fk
              FOREIGN KEY (primary_instructional_leader_id)
              REFERENCES people(employee_id) ON DELETE SET NULL;
          EXCEPTION WHEN duplicate_object THEN NULL;
          END $$;
        `);

        await client.query("COMMIT");
        logger.info("[migrate-to-people] Phase A complete ✓");
      } catch (err) {
        await client.query("ROLLBACK");
        logger.error({ err }, "[migrate-to-people] Phase A FAILED — rolled back");
        throw err;
      }
    } else {
      logger.info("[migrate-to-people] Phase A already complete — skipping");
    }

    /* ══ PHASE B: Add text FK columns, backfill, validate, drop old int FKs ══
       Runs only when observations.teacher_id column still exists.
       Sub-case: if teachers table is already gone (dev after first migration
       ran, then Drizzle push re-added the legacy column), just drop the
       columns without backfilling — data was already migrated.              */
    if (teacherColExists && !teachersTableExists) {
      logger.info("[migrate-to-people] Phase B (cleanup): teacher_id present but teachers table gone — dropping legacy columns only");
      await client.query(`
        ALTER TABLE observations
          DROP COLUMN IF EXISTS teacher_id,
          DROP COLUMN IF EXISTS observer_id,
          DROP COLUMN IF EXISTS edited_by_id
      `);
      logger.info("[migrate-to-people] Phase B (cleanup) complete ✓");
    } else if (teacherColExists) {
      logger.info("[migrate-to-people] Phase B: backfilling observations and dropping legacy int FK columns");
      await client.query("BEGIN");
      try {
        /* 6. Add new text FK columns to observations (IF NOT EXISTS is safe to re-run) */
        await client.query(`
          ALTER TABLE observations
            ADD COLUMN IF NOT EXISTS observed_employee_id   text REFERENCES people(employee_id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS observer_employee_id   text REFERENCES people(employee_id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS edited_by_employee_id  text REFERENCES people(employee_id) ON DELETE SET NULL
        `);

        /* 7. Backfill observed_employee_id from teachers */
        await client.query(`
          UPDATE observations o
          SET observed_employee_id = COALESCE(NULLIF(TRIM(t.employee_id), ''), 'T' || o.teacher_id::text)
          FROM teachers t
          WHERE o.teacher_id = t.id
            AND t.email IS NOT NULL AND TRIM(t.email) <> ''
            AND o.observed_employee_id IS NULL
        `);

        /* 8. Backfill observer_employee_id — join via email so that users
           whose email conflicted with a teacher get the correct employee_id
           (the teacher-seeded record) rather than a synthetic "U<id>" that
           may not exist in people.                                          */
        await client.query(`
          UPDATE observations o
          SET observer_employee_id = p.employee_id
          FROM users u
          JOIN people p ON LOWER(TRIM(u.email)) = p.email
          WHERE o.observer_id = u.id
            AND o.observer_employee_id IS NULL
        `);

        /* 9. Backfill edited_by_employee_id — same email-join approach */
        await client.query(`
          UPDATE observations o
          SET edited_by_employee_id = p.employee_id
          FROM users u
          JOIN people p ON LOWER(TRIM(u.email)) = p.email
          WHERE o.edited_by_id = u.id
            AND o.edited_by_employee_id IS NULL
        `);

        /* 10. Validate — ABORT if any teacher-linked observation lost its backfill */
        const { rows: orphanRows } = await client.query<{ count: string }>(`
          SELECT COUNT(*)::text AS count
          FROM observations
          WHERE teacher_id IS NOT NULL AND observed_employee_id IS NULL
        `);
        const orphanCount = parseInt(orphanRows[0]?.count ?? "0", 10);
        if (orphanCount > 0) {
          throw new Error(
            `[migrate-to-people] ABORTED: ${orphanCount} observation(s) could not be backfilled ` +
            `(teacher_id present but observed_employee_id is NULL). ` +
            `Ensure every teacher linked to an observation has a non-empty email before running the migration.`,
          );
        }

        /* 11. Drop old integer FK columns from observations */
        await client.query(`
          ALTER TABLE observations
            DROP COLUMN IF EXISTS teacher_id,
            DROP COLUMN IF EXISTS observer_id,
            DROP COLUMN IF EXISTS edited_by_id
        `);

        await client.query("COMMIT");
        logger.info("[migrate-to-people] Phase B complete ✓");
      } catch (err) {
        await client.query("ROLLBACK");
        logger.error({ err }, "[migrate-to-people] Phase B FAILED — rolled back");
        throw err;
      }
    } else {
      logger.info("[migrate-to-people] Phase B already complete — skipping");
    }

    /* ══ PHASE C: Drop legacy tables ════════════════════════════════
       Runs outside a transaction (DDL with CASCADE).
       Each DROP is conditional so it is safe to re-run.             */
    if (teachersTableExists || usersTableExists) {
      logger.info("[migrate-to-people] Phase C: dropping legacy teachers and users tables");
      if (teachersTableExists) {
        await client.query("DROP TABLE IF EXISTS teachers CASCADE");
        logger.info("[migrate-to-people] Dropped teachers table");
      }
      if (usersTableExists) {
        await client.query("DROP TABLE IF EXISTS users CASCADE");
        logger.info("[migrate-to-people] Dropped users table");
      }
      logger.info("[migrate-to-people] Phase C complete ✓");
    } else {
      logger.info("[migrate-to-people] Phase C already complete — skipping");
    }

    logger.info("[migrate-to-people] Migration complete ✓");
  } catch (err) {
    logger.error({ err }, "[migrate-to-people] Migration FAILED");
    throw err;
  } finally {
    client.release();
  }
}
