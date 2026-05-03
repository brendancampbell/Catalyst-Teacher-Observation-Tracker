import { db, pool } from "@workspace/db";
import {
  schools, teachers, users, observations, observationScores,
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
    { name: "Roxbury Prep",           region: "Boston",   gradeSpan: "MS" },
    { name: "Camden Prep",            region: "Camden",   gradeSpan: "ES" },
    { name: "North Star Academy",     region: "Newark",   gradeSpan: "HS" },
    { name: "Uncommon Collegiate",    region: "NYC",      gradeSpan: "HS" },
    { name: "Leadership Prep Ocean Hill", region: "NYC",  gradeSpan: "MS" },
  ]).returning();

  console.log("Inserting users…");
  await db.insert(users).values([
    { email: "bcampbell@uncommonschools.org",  name: "Brendan Campbell",   role: "NETWORK_ADMIN", schoolId: null },
    { email: "jrivera@uncommonschools.org",    name: "Jessica Rivera",     role: "NETWORK_LEADER", schoolId: null },
    { email: "mwilson@uncommonschools.org",    name: "Marcus Wilson",      role: "SCHOOL_LEADER",  schoolId: insertedSchools[0].id },
    { email: "alee@uncommonschools.org",       name: "Amanda Lee",         role: "SCHOOL_LEADER",  schoolId: insertedSchools[1].id },
    { email: "dthompson@uncommonschools.org",  name: "David Thompson",     role: "SCHOOL_LEADER",  schoolId: insertedSchools[2].id },
    { email: "kwilliams@uncommonschools.org",  name: "Karen Williams",     role: "SCHOOL_LEADER",  schoolId: insertedSchools[3].id },
    { email: "pjohnson@uncommonschools.org",   name: "Patricia Johnson",   role: "SCHOOL_LEADER",  schoolId: insertedSchools[4].id },
    { email: "coach1@uncommonschools.org",     name: "Robert Chen",        role: "COACH",           schoolId: insertedSchools[0].id },
    { email: "coach2@uncommonschools.org",     name: "Sandra Ortiz",       role: "COACH",           schoolId: insertedSchools[1].id },
  ]).onConflictDoNothing().returning();

  console.log("Inserting teachers…");
  const teacherSeeds = [
    { name: "Aaliyah Brooks",    subject: "Math",    gradeLevel: ["5", "6"],    schoolId: insertedSchools[0].id, isActive: true },
    { name: "Brandon Kim",       subject: "ELA",     gradeLevel: ["6", "7"],    schoolId: insertedSchools[0].id, isActive: true },
    { name: "Carmen Diaz",       subject: "Science", gradeLevel: ["7", "8"],    schoolId: insertedSchools[0].id, isActive: true },
    { name: "Derek Stone",       subject: "History", gradeLevel: ["5"],         schoolId: insertedSchools[0].id, isActive: true },
    { name: "Emily Nguyen",      subject: "Math",    gradeLevel: ["8"],         schoolId: insertedSchools[0].id, isActive: true },
    { name: "Felix Morales",     subject: "ELA",     gradeLevel: ["5", "6"],    schoolId: insertedSchools[0].id, isActive: true },

    { name: "Grace Liu",         subject: "Math",    gradeLevel: ["K", "1"],    schoolId: insertedSchools[1].id, isActive: true },
    { name: "Henry Park",        subject: "ELA",     gradeLevel: ["2", "3"],    schoolId: insertedSchools[1].id, isActive: true },
    { name: "Isabel Torres",     subject: "Science", gradeLevel: ["4", "5"],    schoolId: insertedSchools[1].id, isActive: true },
    { name: "James Wright",      subject: "History", gradeLevel: ["3", "4"],    schoolId: insertedSchools[1].id, isActive: true },
    { name: "Keisha Robinson",   subject: "Math",    gradeLevel: ["1", "2"],    schoolId: insertedSchools[1].id, isActive: true },

    { name: "Liam Foster",       subject: "Math",    gradeLevel: ["9", "10"],   schoolId: insertedSchools[2].id, isActive: true },
    { name: "Maya Patel",        subject: "ELA",     gradeLevel: ["11", "12"],  schoolId: insertedSchools[2].id, isActive: true },
    { name: "Noah Baker",        subject: "Science", gradeLevel: ["9", "10"],   schoolId: insertedSchools[2].id, isActive: true },
    { name: "Olivia Grant",      subject: "History", gradeLevel: ["11"],        schoolId: insertedSchools[2].id, isActive: true },
    { name: "Patrick Harris",    subject: "Math",    gradeLevel: ["12"],        schoolId: insertedSchools[2].id, isActive: true },

    { name: "Quinn Edwards",     subject: "ELA",     gradeLevel: ["9", "10"],   schoolId: insertedSchools[3].id, isActive: true },
    { name: "Rachel Mitchell",   subject: "Science", gradeLevel: ["11", "12"],  schoolId: insertedSchools[3].id, isActive: true },
    { name: "Samuel Carter",     subject: "Math",    gradeLevel: ["9"],         schoolId: insertedSchools[3].id, isActive: true },
    { name: "Tanya Simmons",     subject: "History", gradeLevel: ["10", "11"],  schoolId: insertedSchools[3].id, isActive: true },

    { name: "Ulysses Bell",      subject: "Math",    gradeLevel: ["5", "6"],    schoolId: insertedSchools[4].id, isActive: true },
    { name: "Vivian Ross",       subject: "ELA",     gradeLevel: ["6", "7"],    schoolId: insertedSchools[4].id, isActive: true },
    { name: "Walter Coleman",    subject: "Science", gradeLevel: ["7", "8"],    schoolId: insertedSchools[4].id, isActive: true },
    { name: "Xara Jenkins",      subject: "History", gradeLevel: ["8"],         schoolId: insertedSchools[4].id, isActive: true },
    { name: "Yusuf Ahmad",       subject: "Math",    gradeLevel: ["5"],         schoolId: insertedSchools[4].id, isActive: true },
  ];

  const teacherRows = teacherSeeds.map((t) => {
    const [first, ...rest] = t.name.toLowerCase().split(/\s+/);
    const last = rest.join("");
    return { ...t, email: `${first}.${last}@uncommonschools.org` };
  });

  const insertedTeachers = await db.insert(teachers).values(teacherRows).returning();

  console.log("Inserting observations and scores…");
  const observerNames = ["Marcus Wilson", "Jessica Rivera", "Brendan Campbell", "Amanda Lee", "David Thompson"];

  for (const teacher of insertedTeachers) {
    const numObs = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < numObs; i++) {
      const daysAgo = 5 + i * 14 + Math.floor(Math.random() * 7);
      const observer = observerNames[Math.floor(Math.random() * observerNames.length)];
      const isWalkthrough = Math.random() < 0.3;

      const [obs] = await db.insert(observations).values({
        teacherId:    teacher.id,
        rubricSetId:  rubricSetId,
        date:         rDate(daysAgo),
        observer,
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
  console.log(`✓ ${teacherRows.length} teachers`);
  console.log(`✓ Observations with scores for each teacher`);
  console.log("=== DEV SEED COMPLETE ===");
  await pool.end();
}

seedDev().catch((err) => {
  console.error("Dev seed failed:", err);
  process.exit(1);
});
