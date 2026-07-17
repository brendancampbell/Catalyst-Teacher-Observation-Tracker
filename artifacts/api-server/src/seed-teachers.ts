import { db, pool } from "@workspace/db";
import {
  people, schools, observations, observationScores,
  rubricQuarters,
} from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";

const DOMAIN_SLUGS = [
  "confident_presence", "wtd_cycle", "ratio_engagement", "joy",
  "f15_entry", "f15_fluency", "f15_launch",
  "lp_mks", "annotations", "academic_mon",
];

const SCORES = [0, 0.5, 1.0] as const;
function rScore(): number {
  const weights = [0.15, 0.35, 0.5];
  const r = Math.random();
  if (r < weights[0]) return SCORES[0];
  if (r < weights[0] + weights[1]) return SCORES[1];
  return SCORES[2];
}

function rDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

const TARGET_ABBREVIATIONS = ["RXP_DC", "CP_CMS", "NSA_LPMS", "RP_BCMS", "NYC_UKMS"];

const TEACHER_SEEDS: Array<{
  employeeId: string;
  firstName: string;
  lastName: string;
  department: "Math" | "English" | "Science" | "History";
  gradeLevel: string[];
  schoolAbbr: string;
}> = [
  { employeeId: "DEMO-T-001", firstName: "Aaliyah",  lastName: "Brooks",   department: "Math",    gradeLevel: ["5", "6"], schoolAbbr: "RXP_DC" },
  { employeeId: "DEMO-T-002", firstName: "Brandon",  lastName: "Kim",      department: "English", gradeLevel: ["6", "7"], schoolAbbr: "RXP_DC" },
  { employeeId: "DEMO-T-003", firstName: "Carmen",   lastName: "Diaz",     department: "Science", gradeLevel: ["7", "8"], schoolAbbr: "RXP_DC" },
  { employeeId: "DEMO-T-004", firstName: "Derek",    lastName: "Stone",    department: "History", gradeLevel: ["5"],      schoolAbbr: "RXP_DC" },
  { employeeId: "DEMO-T-005", firstName: "Emily",    lastName: "Nguyen",   department: "Math",    gradeLevel: ["8"],      schoolAbbr: "RXP_DC" },
  { employeeId: "DEMO-T-006", firstName: "Felix",    lastName: "Morales",  department: "English", gradeLevel: ["5", "6"], schoolAbbr: "RXP_DC" },

  { employeeId: "DEMO-T-007", firstName: "Grace",    lastName: "Liu",      department: "Math",    gradeLevel: ["6", "7"], schoolAbbr: "CP_CMS" },
  { employeeId: "DEMO-T-008", firstName: "Henry",    lastName: "Park",     department: "English", gradeLevel: ["7", "8"], schoolAbbr: "CP_CMS" },
  { employeeId: "DEMO-T-009", firstName: "Isabel",   lastName: "Torres",   department: "Science", gradeLevel: ["6"],      schoolAbbr: "CP_CMS" },
  { employeeId: "DEMO-T-010", firstName: "James",    lastName: "Wright",   department: "History", gradeLevel: ["7", "8"], schoolAbbr: "CP_CMS" },
  { employeeId: "DEMO-T-011", firstName: "Keisha",   lastName: "Robinson", department: "Math",    gradeLevel: ["8"],      schoolAbbr: "CP_CMS" },

  { employeeId: "DEMO-T-012", firstName: "Liam",     lastName: "Foster",   department: "Math",    gradeLevel: ["6", "7"], schoolAbbr: "NSA_LPMS" },
  { employeeId: "DEMO-T-013", firstName: "Maya",     lastName: "Patel",    department: "English", gradeLevel: ["7", "8"], schoolAbbr: "NSA_LPMS" },
  { employeeId: "DEMO-T-014", firstName: "Noah",     lastName: "Baker",    department: "Science", gradeLevel: ["6"],      schoolAbbr: "NSA_LPMS" },
  { employeeId: "DEMO-T-015", firstName: "Olivia",   lastName: "Grant",    department: "History", gradeLevel: ["8"],      schoolAbbr: "NSA_LPMS" },
  { employeeId: "DEMO-T-016", firstName: "Patrick",  lastName: "Harris",   department: "Math",    gradeLevel: ["7"],      schoolAbbr: "NSA_LPMS" },

  { employeeId: "DEMO-T-017", firstName: "Quinn",    lastName: "Edwards",  department: "English", gradeLevel: ["6", "7"], schoolAbbr: "RP_BCMS" },
  { employeeId: "DEMO-T-018", firstName: "Rachel",   lastName: "Mitchell", department: "Science", gradeLevel: ["7", "8"], schoolAbbr: "RP_BCMS" },
  { employeeId: "DEMO-T-019", firstName: "Samuel",   lastName: "Carter",   department: "Math",    gradeLevel: ["6"],      schoolAbbr: "RP_BCMS" },
  { employeeId: "DEMO-T-020", firstName: "Tanya",    lastName: "Simmons",  department: "History", gradeLevel: ["7", "8"], schoolAbbr: "RP_BCMS" },
  { employeeId: "DEMO-T-021", firstName: "Ulysses",  lastName: "Bell",     department: "Math",    gradeLevel: ["5", "6"], schoolAbbr: "RP_BCMS" },

  { employeeId: "DEMO-T-022", firstName: "Vivian",   lastName: "Ross",     department: "English", gradeLevel: ["6", "7"], schoolAbbr: "NYC_UKMS" },
  { employeeId: "DEMO-T-023", firstName: "Walter",   lastName: "Coleman",  department: "Science", gradeLevel: ["7", "8"], schoolAbbr: "NYC_UKMS" },
  { employeeId: "DEMO-T-024", firstName: "Xara",     lastName: "Jenkins",  department: "History", gradeLevel: ["8"],      schoolAbbr: "NYC_UKMS" },
  { employeeId: "DEMO-T-025", firstName: "Yusuf",    lastName: "Ahmad",    department: "Math",    gradeLevel: ["5", "6"], schoolAbbr: "NYC_UKMS" },
  { employeeId: "DEMO-T-026", firstName: "Zoe",      lastName: "Chambers", department: "English", gradeLevel: ["6"],      schoolAbbr: "NYC_UKMS" },
];

async function seedTeachers() {
  console.log("=== SEED TEACHERS START ===");

  const existingQ = await db.select().from(rubricQuarters).where(eq(rubricQuarters.slug, "Q1"));
  if (existingQ.length === 0) {
    console.error("ERROR: Q1 rubric quarter not found. Run the base seed first.");
    await pool.end();
    process.exit(1);
  }
  const rubricSetId = existingQ[0].id;
  console.log(`Using rubricSetId=${rubricSetId} (Q1)`);

  const foundSchools = await db
    .select()
    .from(schools)
    .where(inArray(schools.abbreviation, TARGET_ABBREVIATIONS));

  if (foundSchools.length === 0) {
    console.error("ERROR: No target schools found. Ensure the server has been started at least once to auto-seed schools.");
    await pool.end();
    process.exit(1);
  }

  const schoolMap = new Map(foundSchools.map((s) => [s.abbreviation, s.id]));
  console.log(`Found ${foundSchools.length} of ${TARGET_ABBREVIATIONS.length} target schools:`);
  for (const s of foundSchools) {
    console.log(`  ${s.abbreviation} → id=${s.id} (${s.displayName})`);
  }

  const teacherValues = TEACHER_SEEDS
    .filter((t) => schoolMap.has(t.schoolAbbr))
    .map((t) => ({
      employeeId:             t.employeeId,
      firstName:              t.firstName,
      lastName:               t.lastName,
      email:                  `${t.firstName.toLowerCase()}.${t.lastName.toLowerCase()}.demo@uncommonschools.org`,
      role:                   "NO_ACCESS" as const,
      isActive:               true,
      includeInFeedbackTracker: true,
      schoolId:               schoolMap.get(t.schoolAbbr)!,
      department:             t.department,
      gradeLevel:             t.gradeLevel,
    }));

  console.log(`Inserting ${teacherValues.length} teachers (skipping conflicts)…`);
  const insertedTeachers = await db
    .insert(people)
    .values(teacherValues)
    .onConflictDoNothing()
    .returning();

  console.log(`  → ${insertedTeachers.length} new teachers inserted (${teacherValues.length - insertedTeachers.length} already existed, skipped)`);

  if (insertedTeachers.length === 0) {
    console.log("All teachers already present — skipping observations.");
    console.log("=== SEED TEACHERS COMPLETE (no-op) ===");
    await pool.end();
    return;
  }

  const observerNames = [
    "Marcus Wilson", "Jessica Rivera", "Amanda Lee",
    "David Thompson", "Karen Williams",
  ];

  let totalObs = 0;
  console.log("Inserting observations and scores for new teachers…");

  for (const teacher of insertedTeachers) {
    const numObs = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < numObs; i++) {
      const daysAgo = 5 + i * 14 + Math.floor(Math.random() * 7);
      const observer = observerNames[Math.floor(Math.random() * observerNames.length)];
      const isWalkthrough = Math.random() < 0.3;

      const [obs] = await db.insert(observations).values({
        schoolYearId:                1,
        observedEmployeeId: teacher.employeeId,
        rubricSetId,
        date:               rDate(daysAgo),
        observer,
        isWalkthrough,
        strengths:   isWalkthrough ? null : "Strong routines and student engagement throughout.",
        growthAreas: isWalkthrough ? null : "Continue developing academic monitoring strategies.",
      }).returning();

      await db.insert(observationScores).values(
        DOMAIN_SLUGS.map((slug) => ({
          observationId: obs.id,
          domainSlug:    slug,
          score:         rScore(),
        }))
      );

      totalObs++;
    }
  }

  console.log(`✓ ${insertedTeachers.length} teachers inserted`);
  console.log(`✓ ${totalObs} observations with scores`);
  console.log("=== SEED TEACHERS COMPLETE ===");
  await pool.end();
}

seedTeachers().catch((err) => {
  console.error("seed-teachers failed:", err);
  process.exit(1);
});
