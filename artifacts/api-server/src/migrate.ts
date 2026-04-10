import { pool } from "@workspace/db";

/** Add a unique constraint to a table if it doesn't already exist. */
async function ensureUnique(
  client: Awaited<ReturnType<typeof pool.connect>>,
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

    /* ── 2. Add NETWORK_LEADER enum value if it doesn't exist yet ── */
    const { rows: enumRows } = await client.query<{ exists: boolean }>(`
      SELECT EXISTS(
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'user_role' AND e.enumlabel = 'NETWORK_LEADER'
      ) AS exists
    `);
    if (!enumRows[0].exists) {
      console.log("  Adding NETWORK_LEADER to user_role enum…");
      await client.query(`ALTER TYPE user_role ADD VALUE 'NETWORK_LEADER' BEFORE 'DISTRICT_ADMIN'`);
      console.log("  Done.");
    } else {
      console.log("  user_role enum: NETWORK_LEADER already present.");
    }

    /* ── 3. Pre-apply all unique constraints drizzle-kit would
            prompt about when adding them to existing tables. ── */
    await ensureUnique(client, "users_email_unique",    "users",       "email");
    await ensureUnique(client, "rubric_sets_slug_unique", "rubric_sets", "slug");

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
