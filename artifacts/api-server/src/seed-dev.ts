import { db, pool } from "@workspace/db";
import {
  people, schools, observations, observationScores,
  rubricQuarters,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";

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

async function seedDev() {
  console.log("=== DEV SEED START ===");

  const existingQ = await db.select().from(rubricQuarters).where(eq(rubricQuarters.slug, "Q1"));
  if (existingQ.length === 0) {
    console.error("ERROR: Q1 rubric set not found. Run the base seed first.");
    await pool.end();
    process.exit(1);
  }
  const rubricSetId = existingQ[0].id;

  const existingSchools = await db.select().from(schools);
  if (existingSchools.length > 0) {
    console.log(`Dev data already present (${existingSchools.length} schools) — skipping.`);
    await pool.end();
    return;
  }

  console.log("Inserting schools…");
  const insertedSchools = await db.insert(schools).values([
    { displayName: "Roxbury Prep",               region: "Boston", gradeSpan: "MS" },
    { displayName: "Camden Prep",                region: "Camden", gradeSpan: "ES" },
    { displayName: "North Star Academy",         region: "Newark", gradeSpan: "HS" },
    { displayName: "Uncommon Collegiate",        region: "NYC",    gradeSpan: "HS" },
    { displayName: "Leadership Prep Ocean Hill", region: "NYC",    gradeSpan: "MS" },
  ]).returning();

  console.log("Inserting staff (admins / leaders / coaches)…");
  await db.insert(people).values([
    { employeeId: "EMP-ADM-001", firstName: "Brendan",  lastName: "Campbell",  email: "bcampbell@uncommonschools.org",  role: "NETWORK_ADMIN",   schoolId: null,                    includeInFeedbackTracker: false },
    { employeeId: "EMP-ADM-002", firstName: "Jessica",  lastName: "Rivera",    email: "jrivera@uncommonschools.org",    role: "NETWORK_LEADER",  schoolId: null,                    includeInFeedbackTracker: false },
    { employeeId: "EMP-SL-001",  firstName: "Marcus",   lastName: "Wilson",    email: "mwilson@uncommonschools.org",    role: "SCHOOL_LEADER",   schoolId: insertedSchools[0].id,   includeInFeedbackTracker: false },
    { employeeId: "EMP-SL-002",  firstName: "Amanda",   lastName: "Lee",       email: "alee@uncommonschools.org",       role: "SCHOOL_LEADER",   schoolId: insertedSchools[1].id,   includeInFeedbackTracker: false },
    { employeeId: "EMP-SL-003",  firstName: "David",    lastName: "Thompson",  email: "dthompson@uncommonschools.org",  role: "SCHOOL_LEADER",   schoolId: insertedSchools[2].id,   includeInFeedbackTracker: false },
    { employeeId: "EMP-SL-004",  firstName: "Karen",    lastName: "Williams",  email: "kwilliams@uncommonschools.org",  role: "SCHOOL_LEADER",   schoolId: insertedSchools[3].id,   includeInFeedbackTracker: false },
    { employeeId: "EMP-SL-005",  firstName: "Patricia", lastName: "Johnson",   email: "pjohnson@uncommonschools.org",   role: "SCHOOL_LEADER",   schoolId: insertedSchools[4].id,   includeInFeedbackTracker: false },
    { employeeId: "EMP-CO-001",  firstName: "Robert",   lastName: "Chen",      email: "coach1@uncommonschools.org",     role: "COACH",           schoolId: insertedSchools[0].id,   includeInFeedbackTracker: false },
    { employeeId: "EMP-CO-002",  firstName: "Sandra",   lastName: "Ortiz",     email: "coach2@uncommonschools.org",     role: "COACH",           schoolId: insertedSchools[1].id,   includeInFeedbackTracker: false },
  ]).onConflictDoNothing();

  console.log("Inserting teachers (as people)…");
  type Department = "Math" | "English" | "Science" | "History";
  const teacherSeeds: { employeeId: string; firstName: string; lastName: string; department: Department; gradeLevel: string[]; schoolId: number }[] = [
    { employeeId: "EMP-T-001", firstName: "Aaliyah",  lastName: "Brooks",   department: "Math",    gradeLevel: ["5","6"],     schoolId: insertedSchools[0].id },
    { employeeId: "EMP-T-002", firstName: "Brandon",  lastName: "Kim",      department: "English", gradeLevel: ["6","7"],     schoolId: insertedSchools[0].id },
    { employeeId: "EMP-T-003", firstName: "Carmen",   lastName: "Diaz",     department: "Science", gradeLevel: ["7","8"],     schoolId: insertedSchools[0].id },
    { employeeId: "EMP-T-004", firstName: "Derek",    lastName: "Stone",    department: "History", gradeLevel: ["5"],         schoolId: insertedSchools[0].id },
    { employeeId: "EMP-T-005", firstName: "Emily",    lastName: "Nguyen",   department: "Math",    gradeLevel: ["8"],         schoolId: insertedSchools[0].id },
    { employeeId: "EMP-T-006", firstName: "Felix",    lastName: "Morales",  department: "English", gradeLevel: ["5","6"],     schoolId: insertedSchools[0].id },

    { employeeId: "EMP-T-007", firstName: "Grace",    lastName: "Liu",      department: "Math",    gradeLevel: ["K","1"],     schoolId: insertedSchools[1].id },
    { employeeId: "EMP-T-008", firstName: "Henry",    lastName: "Park",     department: "English", gradeLevel: ["2","3"],     schoolId: insertedSchools[1].id },
    { employeeId: "EMP-T-009", firstName: "Isabel",   lastName: "Torres",   department: "Science", gradeLevel: ["4","5"],     schoolId: insertedSchools[1].id },
    { employeeId: "EMP-T-010", firstName: "James",    lastName: "Wright",   department: "History", gradeLevel: ["3","4"],     schoolId: insertedSchools[1].id },
    { employeeId: "EMP-T-011", firstName: "Keisha",   lastName: "Robinson", department: "Math",    gradeLevel: ["1","2"],     schoolId: insertedSchools[1].id },

    { employeeId: "EMP-T-012", firstName: "Liam",     lastName: "Foster",   department: "Math",    gradeLevel: ["9","10"],    schoolId: insertedSchools[2].id },
    { employeeId: "EMP-T-013", firstName: "Maya",     lastName: "Patel",    department: "English", gradeLevel: ["11","12"],   schoolId: insertedSchools[2].id },
    { employeeId: "EMP-T-014", firstName: "Noah",     lastName: "Baker",    department: "Science", gradeLevel: ["9","10"],    schoolId: insertedSchools[2].id },
    { employeeId: "EMP-T-015", firstName: "Olivia",   lastName: "Grant",    department: "History", gradeLevel: ["11"],        schoolId: insertedSchools[2].id },
    { employeeId: "EMP-T-016", firstName: "Patrick",  lastName: "Harris",   department: "Math",    gradeLevel: ["12"],        schoolId: insertedSchools[2].id },

    { employeeId: "EMP-T-017", firstName: "Quinn",    lastName: "Edwards",  department: "English", gradeLevel: ["9","10"],    schoolId: insertedSchools[3].id },
    { employeeId: "EMP-T-018", firstName: "Rachel",   lastName: "Mitchell", department: "Science", gradeLevel: ["11","12"],   schoolId: insertedSchools[3].id },
    { employeeId: "EMP-T-019", firstName: "Samuel",   lastName: "Carter",   department: "Math",    gradeLevel: ["9"],         schoolId: insertedSchools[3].id },
    { employeeId: "EMP-T-020", firstName: "Tanya",    lastName: "Simmons",  department: "History", gradeLevel: ["10","11"],   schoolId: insertedSchools[3].id },

    { employeeId: "EMP-T-021", firstName: "Ulysses",  lastName: "Bell",     department: "Math",    gradeLevel: ["5","6"],     schoolId: insertedSchools[4].id },
    { employeeId: "EMP-T-022", firstName: "Vivian",   lastName: "Ross",     department: "English", gradeLevel: ["6","7"],     schoolId: insertedSchools[4].id },
    { employeeId: "EMP-T-023", firstName: "Walter",   lastName: "Coleman",  department: "Science", gradeLevel: ["7","8"],     schoolId: insertedSchools[4].id },
    { employeeId: "EMP-T-024", firstName: "Xara",     lastName: "Jenkins",  department: "History", gradeLevel: ["8"],         schoolId: insertedSchools[4].id },
    { employeeId: "EMP-T-025", firstName: "Yusuf",    lastName: "Ahmad",    department: "Math",    gradeLevel: ["5"],         schoolId: insertedSchools[4].id },
  ];

  const insertedTeachers = await db.insert(people).values(
    teacherSeeds.map((t) => ({
      ...t,
      email: `${t.firstName.toLowerCase()}.${t.lastName.toLowerCase()}@uncommonschools.org`,
      role:  "NO_ACCESS" as const,
      isActive: true,
      includeInFeedbackTracker: true,
    }))
  ).returning();

  console.log("Inserting observations and scores…");
  for (const teacher of insertedTeachers) {
    const numObs = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < numObs; i++) {
      const daysAgo = 5 + i * 14 + Math.floor(Math.random() * 7);
      const isWalkthrough = Math.random() < 0.3;

      const [obs] = await db.insert(observations).values({
        observedEmployeeId: teacher.employeeId,
        rubricSetId:        rubricSetId,
        date:               rDate(daysAgo),
        isWalkthrough,
        strengths:    isWalkthrough ? null : "Strong routines and student engagement throughout.",
        growthAreas:  isWalkthrough ? null : "Continue developing academic monitoring strategies.",
      }).returning();

      await db.insert(observationScores).values(
        DOMAIN_SLUGS.map((slug) => ({
          observationId: obs.id,
          domainSlug:    slug,
          score:         rScore(),
        }))
      );
    }
  }

  console.log(`✓ ${insertedSchools.length} schools`);
  console.log(`✓ ${teacherSeeds.length} teachers`);
  console.log(`✓ Observations with scores for each teacher`);
  console.log("=== DEV SEED COMPLETE ===");
  await pool.end();
}

seedDev().catch((err) => {
  console.error("Dev seed failed:", err);
  process.exit(1);
});
