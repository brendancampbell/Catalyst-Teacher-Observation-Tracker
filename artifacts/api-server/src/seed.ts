import { db, pool } from "@workspace/db";
import {
  people,
  rubricQuarters, rubricCategories, rubricDomains,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";

async function seed() {
  console.log("Checking if database needs seeding…");

  /* Guard on rubric_domains — not just the rubric set — so that a rebuild
     that wipes and recreates the domains table still re-seeds, even when the
     parent rubric set row survived the drop-recreate cycle. */
  const existingDomains = await db.select({ id: rubricDomains.id }).from(rubricDomains).limit(1);
  if (existingDomains.length > 0) {
    console.log("Database already seeded — skipping.");
    await pool.end();
    return;
  }

  console.log("Seeding database with rubric structure and initial admin user…");

  /* ── Step 1: find or create the Q1 rubric set ─────────────────────────
     The set may survive a domains-only wipe, so we look it up before inserting. */
  let [quarter] = await db
    .select({ id: rubricQuarters.id })
    .from(rubricQuarters)
    .where(eq(rubricQuarters.slug, "Q1"))
    .limit(1);

  if (!quarter) {
    [quarter] = await db.insert(rubricQuarters).values([
      { slug: "Q1", name: "Quarter 1", isActive: true, subjectAudience: "ALL" },
    ]).returning({ id: rubricQuarters.id });
  }

  /* ── Step 2: find or create categories for this rubric set ────────────
     Categories may also survive; match by rubricSetId. */
  let cats = await db
    .select({ id: rubricCategories.id, name: rubricCategories.name })
    .from(rubricCategories)
    .where(eq(rubricCategories.rubricSetId, quarter.id));

  if (cats.length === 0) {
    cats = await db.insert(rubricCategories).values([
      { rubricSetId: quarter.id, name: "Classroom Culture",   displayOrder: 0 },
      { rubricSetId: quarter.id, name: "The First 15",        displayOrder: 1 },
      { rubricSetId: quarter.id, name: "Academic Monitoring", displayOrder: 2 },
    ]).returning({ id: rubricCategories.id, name: rubricCategories.name });
  }

  const catId = Object.fromEntries(cats.map((c) => [c.name, c.id]));

  /* ── Step 3: insert domains (confirmed empty above) ───────────────── */
  await db.insert(rubricDomains).values([
    { categoryId: catId["Classroom Culture"],   rubricSetId: quarter.id, slug: "confident_presence", name: "Confident Presence",             displayOrder: 0 },
    { categoryId: catId["Classroom Culture"],   rubricSetId: quarter.id, slug: "wtd_cycle",          name: "WTD Cycle",                      displayOrder: 1 },
    { categoryId: catId["Classroom Culture"],   rubricSetId: quarter.id, slug: "ratio_engagement",   name: "Ratio & Engagement",             displayOrder: 2 },
    { categoryId: catId["Classroom Culture"],   rubricSetId: quarter.id, slug: "joy",                name: "Joy",                            displayOrder: 3 },
    { categoryId: catId["The First 15"],        rubricSetId: quarter.id, slug: "f15_entry",          name: "F15: Entry/ DN/DNR",             displayOrder: 0 },
    { categoryId: catId["The First 15"],        rubricSetId: quarter.id, slug: "f15_fluency",        name: "F15: Fluency/OD",                displayOrder: 1 },
    { categoryId: catId["The First 15"],        rubricSetId: quarter.id, slug: "f15_launch",         name: "F15: Launch",                    displayOrder: 2 },
    { categoryId: catId["Academic Monitoring"], rubricSetId: quarter.id, slug: "lp_mks",             name: "LP & Mks",                      displayOrder: 0 },
    { categoryId: catId["Academic Monitoring"], rubricSetId: quarter.id, slug: "annotations",        name: "Annotations & Notebook Habits",  displayOrder: 1 },
    { categoryId: catId["Academic Monitoring"], rubricSetId: quarter.id, slug: "academic_mon",       name: "Academic Mon. 101",              displayOrder: 2 },
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
