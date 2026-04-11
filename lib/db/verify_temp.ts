import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./src/schema/index.js";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

async function verify() {
  const users = await db.select().from(schema.users);
  const schools = await db.select().from(schema.schools);
  const teachers = await db.select().from(schema.teachers);
  const observations = await db.select().from(schema.observations);
  const rubricQuarters = await db.select().from(schema.rubricQuarters);
  const rubricCategories = await db.select().from(schema.rubricCategories);
  const rubricDomains = await db.select().from(schema.rubricDomains);

  console.log("Users:", JSON.stringify(users, null, 2));
  console.log("Schools count:", schools.length);
  console.log("Teachers count:", teachers.length);
  console.log("Observations count:", observations.length);
  console.log("Rubric quarters:", rubricQuarters.length);
  console.log("Rubric categories:", rubricCategories.length);
  console.log("Rubric domains:", rubricDomains.length);
  await pool.end();
}

verify().catch(console.error);
