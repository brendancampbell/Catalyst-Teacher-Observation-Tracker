/**
 * One-time data migration: create an `assignments` row for every person
 * who does not already have an active assignment (end_date IS NULL).
 *
 * Safe to run multiple times — idempotent by design.
 *
 * Usage:
 *   cd lib/db
 *   DATABASE_URL=<your-url> pnpm tsx src/migrations/seed-assignments.ts
 *
 * Or from the workspace root:
 *   DATABASE_URL=<your-url> pnpm --filter @workspace/db exec tsx src/migrations/seed-assignments.ts
 */

import pg from "pg";

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required.");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    const today = new Date().toISOString().slice(0, 10);

    const { rows: people } = await client.query<{
      employee_id: string;
      role: string;
      school_id: number | null;
    }>(`
      SELECT p.employee_id, p.role, p.school_id
      FROM   people p
      WHERE  NOT EXISTS (
        SELECT 1 FROM assignments a
        WHERE  a.user_id   = p.employee_id
        AND    a.end_date  IS NULL
      )
    `);

    if (people.length === 0) {
      console.log("No users need a seed assignment — nothing to do.");
      return;
    }

    console.log(`Seeding assignments for ${people.length} user(s)…`);

    let inserted = 0;
    for (const person of people) {
      const result = await client.query(
        `INSERT INTO assignments (user_id, role, school_id, start_date, end_date)
         VALUES ($1, $2, $3, $4, NULL)
         ON CONFLICT DO NOTHING`,
        [person.employee_id, person.role, person.school_id, today],
      );
      inserted += result.rowCount ?? 0;
    }

    console.log(`Done — inserted ${inserted} assignment row(s).`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("seed-assignments failed:", err);
  process.exit(1);
});
