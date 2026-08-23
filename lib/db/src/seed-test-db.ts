/**
 * Fill an empty database with the minimum a test run needs.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * The integration suite has only ever run against the dev database, because
 * nothing could produce a working one from scratch. seed-dev.ts creates
 * schools and people but no school year — and every route filters on the
 * active year, so a database without one cannot serve a single request.
 *
 * The cost of that was three separate backlog items: tests leaving debris in
 * a database people use (#5, #23), a flake that is one test seeing what
 * another left behind (#4), and fixtures guessing at what exists (#6). All of
 * them are the same problem wearing different clothes: forty-nine test files
 * sharing one long-lived database.
 *
 * ── What it creates, and why exactly this ─────────────────────────────────
 * Read out of the suite rather than invented. Nearly every file asks for
 * whatever happens to be there — "the first two non-home-office schools", "a
 * home office school", "the active school year". Only a handful name anything
 * specific, and this creates precisely those:
 *
 *   U10          NETWORK_ADMIN, used by 28 files to log in
 *   U13          SCHOOL_LEADER at RXP_DC
 *   DEMO-T-001…6 the six demo teachers the visibility tests count
 *   RXP_DC       named by the demo-teacher tests
 *   RXP_HS       named as the school those teachers must NOT appear in
 *
 * Everything else is scaffolding to make those usable: a home office school,
 * two more real schools so "first two" has something to find, one active
 * school year, and one rubric set with categories and domains.
 *
 * ── Running it ────────────────────────────────────────────────────────────
 * Not for the dev database. scripts/test-db.sh starts a throwaway Postgres,
 * migrates it, and calls this. Running it by hand against anything you care
 * about would insert seed rows into it.
 */

import { db, pool } from "./index.js";
import { schools, people, schoolYears, assignments, rubricSets, rubricCategories, rubricDomains } from "./schema/index.js";
import { eq } from "drizzle-orm";

const TODAY = new Date().toISOString().slice(0, 10);

async function run(): Promise<void> {
  /*
   * A guard, not a courtesy. This writes fixed identities — U10, RXP_DC — and
   * running it against a real database would collide with real people.
   */
  if (process.env.NODE_ENV === "production") {
    console.error("ERROR: seed-test-db refuses to run with NODE_ENV=production.");
    process.exit(1);
  }

  /* ── Schools ── */
  const insertedSchools = await db.insert(schools).values([
    { displayName: "Home Office",        fullName: "Uncommon Schools Home Office", abbreviation: "HO",
      region: "Newark", gradeSpan: "ES", isHomeOffice: true,  schoolNumber: "000" },
    { displayName: "Roxbury Prep DC",    fullName: "Roxbury Prep Dorchester Campus", abbreviation: "RXP_DC",
      region: "Boston", gradeSpan: "MS", isHomeOffice: false, schoolNumber: "101" },
    { displayName: "Roxbury Prep HS",    fullName: "Roxbury Prep High School",       abbreviation: "RXP_HS",
      region: "Boston", gradeSpan: "HS", isHomeOffice: false, schoolNumber: "102" },
    { displayName: "North Star Academy", fullName: "North Star Academy Elementary",  abbreviation: "NSA_ES",
      region: "Newark", gradeSpan: "ES", isHomeOffice: false, schoolNumber: "201" },
  ]).returning({ id: schools.id, abbreviation: schools.abbreviation });

  const schoolId = (abbr: string): number => {
    const found = insertedSchools.find((s) => s.abbreviation === abbr);
    if (!found) throw new Error(`seed bug: school ${abbr} was not created`);
    return found.id;
  };

  /* ── School year ──
     Migration 0001 already seeds one active year, and a partial unique index
     allows exactly one — so inserting a second fails with a duplicate key on
     status. Adopt whichever year is active rather than fighting the
     migration, and only create one if somehow none exists.

     Dates are filled in because the usage report bounds "days used" by the
     year's start, and the migration's row has none. */
  const [existingYear] = await db
    .select({ id: schoolYears.id, name: schoolYears.name, startDate: schoolYears.startDate })
    .from(schoolYears).where(eq(schoolYears.status, "active")).limit(1);

  let yearId: number;
  let yearName: string;
  if (existingYear) {
    yearId = existingYear.id;
    yearName = existingYear.name;
    if (!existingYear.startDate) {
      await db.update(schoolYears)
        .set({ startDate: "2025-08-01", endDate: "2026-06-30" })
        .where(eq(schoolYears.id, yearId));
    }
  } else {
    const [created] = await db.insert(schoolYears).values({
      name: "2025-2026", status: "active", displayOrder: 1,
      startDate: "2025-08-01", endDate: "2026-06-30",
    }).returning({ id: schoolYears.id, name: schoolYears.name });
    yearId = created!.id;
    yearName = created!.name;
  }

  /* ── Rubric set ──
     Tests take "the first rubric set" and expect it to have somewhere to hang
     scores, so it needs categories and domains rather than being a bare row. */
  const [rubric] = await db.insert(rubricSets).values({
    slug: "Q1", name: "Quarter 1", schoolYearId: yearId,
    isActive: true, isArchived: false, displayOrder: 1,
    target: "TEACHER", subjectAudience: "ALL",
  }).returning({ id: rubricSets.id });
  const rubricSetId = rubric!.id;

  const insertedCats = await db.insert(rubricCategories).values([
    { rubricSetId, name: "Classroom Culture", displayOrder: 0 },
    { rubricSetId, name: "Academic Monitoring", displayOrder: 1 },
  ]).returning({ id: rubricCategories.id, name: rubricCategories.name });

  const catId = (name: string): number => insertedCats.find((c) => c.name === name)!.id;

  await db.insert(rubricDomains).values([
    { categoryId: catId("Classroom Culture"),   rubricSetId, schoolYearId: yearId, slug: "on_task",       name: "On Task",             displayOrder: 0 },
    { categoryId: catId("Classroom Culture"),   rubricSetId, schoolYearId: yearId, slug: "transitions",   name: "Transition to Lesson", displayOrder: 1 },
    { categoryId: catId("Academic Monitoring"), rubricSetId, schoolYearId: yearId, slug: "annotations",   name: "Annotations",         displayOrder: 0 },
  ]);

  /* ── People ──
     U10 and U13 are the identities the suite logs in as. The demo teachers
     are counted by the visibility tests, so their school and their tracker
     flag both matter. */
  await db.insert(people).values([
    { employeeId: "U10", firstName: "Test", lastName: "Admin",  email: "u10@example.com",
      role: "NETWORK_ADMIN", schoolId: schoolId("HO"),     isActive: true, includeInFeedbackTracker: false },
    { employeeId: "U13", firstName: "Test", lastName: "Leader", email: "u13@example.com",
      role: "SCHOOL_LEADER", schoolId: schoolId("RXP_DC"), isActive: true, includeInFeedbackTracker: false },
    { employeeId: "U14", firstName: "Test", lastName: "Coach",  email: "u14@example.com",
      role: "COACH",         schoolId: schoolId("RXP_DC"), isActive: true, includeInFeedbackTracker: false },
    { employeeId: "U15", firstName: "Test", lastName: "HSLead", email: "u15@example.com",
      role: "SCHOOL_LEADER", schoolId: schoolId("RXP_HS"), isActive: true, includeInFeedbackTracker: false },
  ]);

  const demoNames: [string, string][] = [
    ["Aaliyah", "Brooks"], ["Brandon", "Kim"], ["Carmen", "Diaz"],
    ["Derek", "Stone"], ["Emily", "Nguyen"], ["Felix", "Morales"],
  ];
  await db.insert(people).values(demoNames.map(([first, last], i) => ({
    employeeId: `DEMO-T-00${i + 1}`,
    firstName: first, lastName: last,
    email: `demo.t.00${i + 1}@example.com`,
    role: "NO_ACCESS" as const,
    schoolId: schoolId("RXP_DC"),
    isActive: true,
    /* The visibility tests query includeInFeedbackTracker=true and expect all
       six back, so this flag is the test, not decoration. */
    includeInFeedbackTracker: true,
    /* Alternating so the subject-audience filter has both kinds to work with. */
    department: (i % 2 === 0 ? "Math" : "English") as "Math" | "English",
  })));

  /*
   * Open assignments in the active year for anyone who logs in. Without one,
   * checkActiveThisYear() sees no current assignment and every request 403s
   * with NOT_ACTIVE_THIS_YEAR — which is exactly the school-year rot that has
   * broken fixtures before. NETWORK_ADMIN is exempt but gets one anyway so
   * the ledger is coherent.
   */
  await db.insert(assignments).values([
    { userId: "U10", role: "NETWORK_ADMIN", schoolId: schoolId("HO"),     schoolYearId: yearId, startDate: TODAY, endDate: null },
    { userId: "U13", role: "SCHOOL_LEADER", schoolId: schoolId("RXP_DC"), schoolYearId: yearId, startDate: TODAY, endDate: null },
    { userId: "U14", role: "COACH",         schoolId: schoolId("RXP_DC"), schoolYearId: yearId, startDate: TODAY, endDate: null },
    { userId: "U15", role: "SCHOOL_LEADER", schoolId: schoolId("RXP_HS"), schoolYearId: yearId, startDate: TODAY, endDate: null },
  ]);

  /* Verify rather than assume — a seed that half-worked would surface as
     forty confusing test failures instead of one clear one. */
  const [admin] = await db.select({ id: people.employeeId }).from(people).where(eq(people.employeeId, "U10")).limit(1);
  if (!admin) throw new Error("seed verification failed: U10 was not created");
  const demos = await db.select({ id: people.employeeId }).from(people).where(eq(people.includeInFeedbackTracker, true));
  if (demos.length !== 6) throw new Error(`seed verification failed: expected 6 demo teachers, found ${demos.length}`);

  console.log("Test database seeded:");
  console.log(`  4 schools (HO, RXP_DC, RXP_HS, NSA_ES)`);
  console.log(`  1 active school year (${yearName})`);
  console.log(`  1 rubric set with 2 categories and 3 domains`);
  console.log(`  4 staff (U10, U13, U14, U15) and 6 demo teachers`);
  await pool.end();
}

run().catch(async (err) => {
  console.error("Fatal error seeding the test database:", err);
  await pool.end().catch(() => {});
  process.exit(1);
});
