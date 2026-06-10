import { db, pool } from "@workspace/db";
import {
  people,
  rubricQuarters, rubricCategories, rubricDomains,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";

async function seed() {
  console.log("Checking if database needs seeding…");

  const existingQ = await db.select().from(rubricQuarters).where(eq(rubricQuarters.slug, "Q1"));
  if (existingQ.length > 0) {
    console.log("Database already seeded — skipping.");
    await pool.end();
    return;
  }

  console.log("Seeding database with rubric structure and initial admin user…");

  const [quarter] = await db.insert(rubricQuarters).values([
    { slug: "Q1", name: "Quarter 1", isActive: true },
  ]).returning();

  const insertedCats = await db.insert(rubricCategories).values([
    { rubricSetId: quarter.id, name: "Classroom Culture",   displayOrder: 0 },
    { rubricSetId: quarter.id, name: "The First 15",        displayOrder: 1 },
    { rubricSetId: quarter.id, name: "Academic Monitoring", displayOrder: 2 },
  ]).returning();

  const catId = Object.fromEntries(insertedCats.map((c) => [c.name, c.id]));

  await db.insert(rubricDomains).values([
    { categoryId: catId["Classroom Culture"],   slug: "confident_presence", name: "Confident Presence",             displayOrder: 0 },
    { categoryId: catId["Classroom Culture"],   slug: "wtd_cycle",          name: "WTD Cycle",                      displayOrder: 1 },
    { categoryId: catId["Classroom Culture"],   slug: "ratio_engagement",   name: "Ratio & Engagement",             displayOrder: 2 },
    { categoryId: catId["Classroom Culture"],   slug: "joy",                name: "Joy",                            displayOrder: 3 },
    { categoryId: catId["The First 15"],        slug: "f15_entry",          name: "F15: Entry/ DN/DNR",             displayOrder: 0 },
    { categoryId: catId["The First 15"],        slug: "f15_fluency",        name: "F15: Fluency/OD",                displayOrder: 1 },
    { categoryId: catId["The First 15"],        slug: "f15_launch",         name: "F15: Launch",                    displayOrder: 2 },
    { categoryId: catId["Academic Monitoring"], slug: "lp_mks",             name: "LP & Mks",                      displayOrder: 0 },
    { categoryId: catId["Academic Monitoring"], slug: "annotations",        name: "Annotations & Notebook Habits",  displayOrder: 1 },
    { categoryId: catId["Academic Monitoring"], slug: "academic_mon",       name: "Academic Mon. 101",              displayOrder: 2 },
  ]);

  await db.insert(people).values([
    {
      employeeId: "EMP-ADMIN-001",
      firstName:  "Brendan",
      lastName:   "Campbell",
      email:      "bcampbell@uncommonschools.org",
      role:       "NETWORK_ADMIN",
      schoolId:   null,
    },
  ]).onConflictDoNothing();

  console.log("Database seeded successfully.");
  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
