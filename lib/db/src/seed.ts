import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import {
  schools, users, teachers,
  observations, observationScores,
} from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

async function seed() {
  console.log("🌱 Running production data reset...");

  await db.delete(observationScores);
  await db.delete(observations);
  await db.delete(teachers);
  await db.delete(users);
  await db.delete(schools);
  console.log("  ✓ Cleared transactional data (rubric structure preserved)");

  await db.insert(users).values([
    {
      name: "Brendan Campbell",
      email: "bcampbell@uncommonschools.org",
      role: "NETWORK_ADMIN",
      schoolId: null,
    },
  ]);
  console.log("  ✓ Seeded user: Brendan Campbell (NETWORK_ADMIN)");

  console.log("✅ Reset complete!");
  await pool.end();
}

seed().catch((err) => { console.error("Seed failed:", err); process.exit(1); });
