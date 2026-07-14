import { pool } from "@workspace/db";
import type { PoolClient } from "pg";

/** Add a unique constraint to a table if it doesn't already exist. */
async function ensureUnique(
  client: PoolClient,
  constraintName: string,
  tableName: string,
  columnName: string,
) {
  const { rows: cr } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conname = $1) AS exists`,
    [constraintName],
  );
  if (cr[0].exists) {
    console.log(`  ${constraintName}: already exists.`);
    return;
  }

  const { rows: tr } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [tableName],
  );
  if (!tr[0].exists) {
    console.log(`  ${constraintName}: table '${tableName}' not yet created — drizzle-kit will handle it.`);
    return;
  }

  console.log(`  Adding ${constraintName} on ${tableName}(${columnName})…`);
  await client.query(
    `ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} UNIQUE (${columnName})`,
  );
  console.log(`  Done.`);
}

async function migrate() {
  const client = await pool.connect();
  try {
    console.log("Running pre-migration checks…");

    /* ── 1. Rename rubric_quarters → rubric_sets if needed ────── */
    const { rows: tableRows } = await client.query<{ has_quarters: boolean; has_sets: boolean }>(`
      SELECT
        EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'rubric_quarters') AS has_quarters,
        EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'rubric_sets')    AS has_sets
    `);
    const { has_quarters, has_sets } = tableRows[0];

    if (has_quarters && !has_sets) {
      console.log("  Renaming rubric_quarters → rubric_sets…");
      await client.query("ALTER TABLE rubric_quarters RENAME TO rubric_sets");
      console.log("  Done.");
    } else {
      console.log("  rubric table: no rename needed.");
    }

    /* ── 2. Rename legacy enum labels where safe, add where needed ──
       Strategy: rename old→new if old exists AND new doesn't exist yet;
       this avoids the Postgres error of renaming to an already-existing
       label. For any new values not covered by renames, ADD them.     */
    type RolePair = { old: string; new: string };
    const legacyRenames: RolePair[] = [
      { old: "PRINCIPAL",     new: "SCHOOL_LEADER" },
      { old: "DISTRICT_ADMIN", new: "NETWORK_ADMIN"  },
    ];
    const requireValues = ["NETWORK_LEADER", "SCHOOL_LEADER", "NETWORK_ADMIN"];

    for (const { old: oldVal, new: newVal } of legacyRenames) {
      const { rows } = await client.query<{ old_exists: boolean; new_exists: boolean }>(
        `SELECT
           EXISTS(SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                  WHERE t.typname = 'user_role' AND e.enumlabel = $1) AS old_exists,
           EXISTS(SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                  WHERE t.typname = 'user_role' AND e.enumlabel = $2) AS new_exists`,
        [oldVal, newVal],
      );
      const { old_exists, new_exists } = rows[0];
      if (old_exists && !new_exists) {
        console.log(`  Renaming enum label '${oldVal}' → '${newVal}'…`);
        await client.query(`ALTER TYPE user_role RENAME VALUE '${oldVal}' TO '${newVal}'`);
        console.log(`  Done.`);
      } else if (old_exists && new_exists) {
        console.log(`  Both '${oldVal}' and '${newVal}' exist — will migrate rows, old label stays dormant.`);
      } else {
        console.log(`  Enum label '${oldVal}': already absent, no rename needed.`);
      }
    }

    /* Now ensure all required new values are present (covers cases where
       the rename was skipped because old label was already absent).     */
    for (const val of requireValues) {
      const { rows } = await client.query<{ exists: boolean }>(
        `SELECT EXISTS(
           SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
           WHERE t.typname = 'user_role' AND e.enumlabel = $1
         ) AS exists`,
        [val],
      );
      if (!rows[0].exists) {
        console.log(`  Adding '${val}' to user_role enum…`);
        await client.query(`ALTER TYPE user_role ADD VALUE '${val}'`);
      }
    }

    /* ── 3 & 4. Legacy users-table steps (skip if table is absent) ── */
    const { rows: usersTableRows } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'users'
       ) AS exists`,
    );
    if (usersTableRows[0].exists) {
      /* ── 3. Data migration: move any remaining rows off legacy labels ── */
      const { rowCount: principalCount } = await client.query(
        `UPDATE users SET role = 'SCHOOL_LEADER' WHERE role::text = 'PRINCIPAL'`,
      );
      if ((principalCount ?? 0) > 0) console.log(`  Migrated ${principalCount} PRINCIPAL → SCHOOL_LEADER`);

      const { rowCount: districtCount } = await client.query(
        `UPDATE users SET role = 'NETWORK_ADMIN' WHERE role::text = 'DISTRICT_ADMIN'`,
      );
      if ((districtCount ?? 0) > 0) console.log(`  Migrated ${districtCount} DISTRICT_ADMIN → NETWORK_ADMIN`);

      /* ── 4. Add google_id column to users if missing ── */
      const { rows: colRows } = await client.query<{ exists: boolean }>(
        `SELECT EXISTS(
           SELECT 1 FROM information_schema.columns
           WHERE table_name = 'users' AND column_name = 'google_id'
         ) AS exists`,
      );
      if (!colRows[0].exists) {
        console.log("  Adding google_id column to users…");
        await client.query(`ALTER TABLE users ADD COLUMN google_id text`);
      }
    } else {
      console.log("  Legacy 'users' table not present — skipping steps 3 & 4.");
    }

    /* ── 5. Pre-apply all unique constraints drizzle-kit would
            prompt about when adding them to existing tables. ── */
    await ensureUnique(client, "users_email_unique",    "users",       "email");
    await ensureUnique(client, "rubric_sets_slug_unique", "rubric_sets", "slug");

    /* ── 6. Add subject_audience enum + column to rubric_sets ──── */
    const { rows: saEnumRows } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM pg_type WHERE typname = 'subject_audience') AS exists`,
    );
    if (!saEnumRows[0].exists) {
      console.log("  Creating subject_audience enum…");
      await client.query(`CREATE TYPE subject_audience AS ENUM ('STEM', 'HUMANITIES', 'ALL')`);
      console.log("  Done.");
    }

    const { rows: saColRows } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'rubric_sets' AND column_name = 'subject_audience'
       ) AS exists`,
    );
    if (!saColRows[0].exists) {
      const { rows: rsExists } = await client.query<{ exists: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'rubric_sets') AS exists`,
      );
      if (rsExists[0].exists) {
        console.log("  Adding subject_audience column to rubric_sets…");
        await client.query(
          `ALTER TABLE rubric_sets ADD COLUMN subject_audience subject_audience NOT NULL DEFAULT 'ALL'`,
        );
        console.log("  Done.");
      }
    }

    /* ── 7. Create chat_sessions table ─────────────────────────── */
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id          SERIAL PRIMARY KEY,
        employee_id TEXT NOT NULL REFERENCES people(employee_id) ON DELETE CASCADE,
        title       TEXT NOT NULL DEFAULT 'New Chat',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS chat_sessions_employee_id_idx ON chat_sessions(employee_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS chat_sessions_updated_at_idx ON chat_sessions(updated_at DESC)
    `);

    /* ── 8. Create chat_messages table ──────────────────────────── */
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id         SERIAL PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role       TEXT NOT NULL,
        content    TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS chat_messages_session_id_idx ON chat_messages(session_id)
    `);

    /* ── 9a. Three-name schools migration (name → display_name + full_name + abbreviation) ── */
    {
      const { rows: schoolColRows } = await client.query<{ column_name: string }>(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'schools'
          AND column_name IN ('name', 'display_name', 'full_name', 'abbreviation')
      `);
      const schoolCols = new Set(schoolColRows.map((r) => r.column_name));
      const hasName        = schoolCols.has("name");
      const hasDisplayName = schoolCols.has("display_name");
      const hasFullName    = schoolCols.has("full_name");
      const hasAbbr        = schoolCols.has("abbreviation");

      if (hasDisplayName && hasFullName && hasAbbr) {
        console.log("  schools three-name fields: already present.");
      } else if (!hasName && !hasDisplayName) {
        console.log("  schools three-name fields: fresh schema, nothing to migrate.");
      } else {
        console.log("  Migrating schools three-name fields…");
        if (!hasDisplayName) {
          await client.query(`ALTER TABLE "schools" ADD COLUMN "display_name" text`);
          if (hasName) {
            await client.query(`UPDATE "schools" SET "display_name" = "name" WHERE "display_name" IS NULL`);
          }
          await client.query(`ALTER TABLE "schools" ALTER COLUMN "display_name" SET NOT NULL`);
        }
        if (!hasFullName) {
          await client.query(`ALTER TABLE "schools" ADD COLUMN "full_name" text`);
        }
        if (!hasAbbr) {
          await client.query(`ALTER TABLE "schools" ADD COLUMN "abbreviation" text`);
        }
        if (hasName) {
          await client.query(`ALTER TABLE "schools" DROP COLUMN "name"`);
        }
        console.log("  Done.");
      }
    }

    /* ── 9. Add rubric_set_slug column to chat_messages ──────────── */
    const { rows: rssColRows } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'chat_messages' AND column_name = 'rubric_set_slug'
       ) AS exists`,
    );
    if (!rssColRows[0].exists) {
      const { rows: cmExists } = await client.query<{ exists: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'chat_messages') AS exists`,
      );
      if (cmExists[0].exists) {
        console.log("  Adding rubric_set_slug column to chat_messages…");
        await client.query(`ALTER TABLE chat_messages ADD COLUMN rubric_set_slug TEXT`);
        console.log("  Done.");
      }
    }

    /* ── 10. Rename schools.name → display_name if still on old schema ── */
    const { rows: schoolsNameRows } = await client.query<{ exists: boolean }>(`
      SELECT EXISTS(
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'schools' AND column_name = 'name'
      ) AS exists
    `);
    if (schoolsNameRows[0].exists) {
      console.log("  Schools: renaming name → display_name…");
      await client.query(`ALTER TABLE schools RENAME COLUMN name TO display_name`);
      console.log("  Done.");
    }

    /* ── 11. Add schools.full_name if missing ── */
    const { rows: schoolsFnRows } = await client.query<{ exists: boolean }>(`
      SELECT EXISTS(
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'schools' AND column_name = 'full_name'
      ) AS exists
    `);
    if (!schoolsFnRows[0].exists) {
      const { rows: schoolsExists } = await client.query<{ exists: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'schools') AS exists`,
      );
      if (schoolsExists[0].exists) {
        console.log("  Schools: adding full_name column…");
        await client.query(`ALTER TABLE schools ADD COLUMN IF NOT EXISTS full_name TEXT`);
        console.log("  Done.");
      }
    }

    /* ── 12. Add schools.abbreviation if missing ── */
    const { rows: schoolsAbbrRows } = await client.query<{ exists: boolean }>(`
      SELECT EXISTS(
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'schools' AND column_name = 'abbreviation'
      ) AS exists
    `);
    if (!schoolsAbbrRows[0].exists) {
      const { rows: schoolsExists2 } = await client.query<{ exists: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'schools') AS exists`,
      );
      if (schoolsExists2[0].exists) {
        console.log("  Schools: adding abbreviation column…");
        await client.query(`ALTER TABLE schools ADD COLUMN IF NOT EXISTS abbreviation TEXT`);
        console.log("  Done.");
      }
    }

    /* ── 13. Add unique constraint on schools.abbreviation ── */
    await ensureUnique(client, "schools_abbreviation_unique", "schools", "abbreviation");

    /* ── 14. Add is_home_office column to schools ── */
    const { rows: homeOfficeColRows } = await client.query<{ exists: boolean }>(`
      SELECT EXISTS(
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'schools' AND column_name = 'is_home_office'
      ) AS exists
    `);
    if (!homeOfficeColRows[0].exists) {
      const { rows: schoolsExists3 } = await client.query<{ exists: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'schools') AS exists`,
      );
      if (schoolsExists3[0].exists) {
        console.log("  Schools: adding is_home_office column…");
        await client.query(`ALTER TABLE schools ADD COLUMN IF NOT EXISTS is_home_office BOOLEAN NOT NULL DEFAULT FALSE`);
        console.log("  Done.");
      }
    }

    /* ── 15. Ensure the Home Office pseudo-school exists ── */
    {
      const { rows: schoolsExists4 } = await client.query<{ exists: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'schools') AS exists`,
      );
      if (schoolsExists4[0].exists) {
        const { rows: hoRows } = await client.query<{ exists: boolean }>(
          `SELECT EXISTS(SELECT 1 FROM schools WHERE is_home_office = TRUE) AS exists`,
        );
        if (!hoRows[0].exists) {
          console.log("  Inserting Home Office pseudo-school…");
          await client.query(`
            INSERT INTO schools (display_name, full_name, abbreviation, region, grade_span, is_home_office, is_active)
            VALUES ('Home Office', 'Home Office', 'HO', '', '', TRUE, TRUE)
            ON CONFLICT (abbreviation) DO UPDATE SET is_home_office = TRUE
          `);
          console.log("  Done.");
        } else {
          console.log("  Home Office pseudo-school: already exists.");
        }
      }
    }

    console.log("Pre-migration complete.");
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error("Pre-migration failed:", err);
  process.exit(1);
});
