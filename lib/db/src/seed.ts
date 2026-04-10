import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import {
  schools, users, teachers,
  rubricQuarters, rubricCategories, rubricDomains,
  observations, observationScores,
} from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

async function seed() {
  console.log("🌱 Seeding database...");

  // ── Clear existing data (FK-safe order) ────────────────────────
  await db.delete(observationScores);
  await db.delete(observations);
  await db.delete(rubricDomains);
  await db.delete(rubricCategories);
  await db.delete(rubricQuarters);
  await db.delete(teachers);
  await db.delete(users);
  await db.delete(schools);
  console.log("  ✓ Cleared existing data");

  // ── Schools ─────────────────────────────────────────────────────
  const [lincoln, washington, roosevelt] = await db
    .insert(schools)
    .values([
      { name: "Lincoln Middle School" },
      { name: "Washington High School" },
      { name: "Roosevelt Elementary" },
    ])
    .returning();
  console.log("  ✓ Created 3 schools");

  // ── Users ────────────────────────────────────────────────────────
  await db.insert(users).values([
    { name: "Principal Rivera",  email: "principal.rivera@uncommon.org",  role: "PRINCIPAL",       schoolId: lincoln.id },
    { name: "Coach Mills",       email: "coach.mills@uncommon.org",       role: "COACH",           schoolId: lincoln.id },
    { name: "VP Okafor",         email: "vp.okafor@uncommon.org",         role: "PRINCIPAL",       schoolId: washington.id },
    { name: "Network Leader",    email: "network.leader@uncommon.org",    role: "NETWORK_LEADER",  schoolId: null },
    { name: "District Admin",    email: "district.admin@uncommon.org",    role: "DISTRICT_ADMIN",  schoolId: null },
  ]);
  console.log("  ✓ Created 5 users");

  // ── Q1 Rubric ────────────────────────────────────────────────────
  const [q1] = await db.insert(rubricQuarters).values({ slug: "Q1", name: "Quarter 1", isActive: true }).returning();

  const CATEGORIES = [
    {
      name: "Classroom Culture",
      domains: [
        { name: "Confident Presence", slug: "confident_presence" },
        { name: "WTD Cycle",          slug: "wtd_cycle" },
        { name: "Ratio & Engagement", slug: "ratio_engagement" },
        { name: "Joy",                slug: "joy" },
      ],
    },
    {
      name: "The First 15",
      domains: [
        { name: "F15: Entry/ DN/DNR", slug: "f15_entry" },
        { name: "F15: Fluency/OD",   slug: "f15_fluency" },
        { name: "F15: Launch",        slug: "f15_launch" },
      ],
    },
    {
      name: "Academic Monitoring",
      domains: [
        { name: "LP & Mks",                    slug: "lp_mks" },
        { name: "Annotations & Notebook Habits", slug: "annotations" },
        { name: "Academic Mon. 101",            slug: "academic_mon" },
      ],
    },
  ];

  for (let ci = 0; ci < CATEGORIES.length; ci++) {
    const cat = CATEGORIES[ci];
    const [dbCat] = await db.insert(rubricCategories)
      .values({ quarterId: q1.id, name: cat.name, displayOrder: ci })
      .returning();
    for (let di = 0; di < cat.domains.length; di++) {
      const dom = cat.domains[di];
      await db.insert(rubricDomains)
        .values({ categoryId: dbCat.id, name: dom.name, slug: dom.slug, displayOrder: di });
    }
  }
  console.log("  ✓ Created Q1 rubric");

  // ── Teachers + Observations ─────────────────────────────────────
  const ALL_SLUGS = [
    "confident_presence","wtd_cycle","ratio_engagement","joy",
    "f15_entry","f15_fluency","f15_launch",
    "lp_mks","annotations","academic_mon",
  ];

  type ObsInput = { date: string; scores: number[]; strengths?: string; growthAreas?: string; observer?: string };

  const TEACHERS: Array<{
    name: string; subject: string; gradeLevel: string[];
    schoolId: number;
    observations: ObsInput[];
  }> = [
    /* ── Lincoln Middle School ── */
    { name: "Sarah Johnson",  subject: "English", gradeLevel: ["6"],     schoolId: lincoln.id, observations: [
      { date: "2026-01-10", scores: [2,2,2,3,2,3,2,2,2,3], strengths: "Strong rapport with students; consistent routines.", growthAreas: "Needs to increase student talk ratio and cold-calling.", observer: "Principal Rivera" },
      { date: "2026-02-14", scores: [3,2,3,3,3,3,3,3,2,3], strengths: "WTD cycle improving; students respond well to joy moments.", growthAreas: "Annotations still inconsistent — push for 100% compliance.", observer: "Coach Mills" },
      { date: "2026-03-12", scores: [3,3,3,4,3,3,3,3,3,3], strengths: "Joy and engagement at high levels; culture feels warm and rigorous.", growthAreas: "Continue strengthening WTD cycle with faster pacing." },
    ]},
    { name: "Priya Patel",    subject: "Science", gradeLevel: ["7"],     schoolId: lincoln.id, observations: [
      { date: "2026-01-08", scores: [4,3,4,4,4,3,4,3,4,4], strengths: "Exceptional engagement; students deeply invested in content.", growthAreas: "F15 Fluency pacing can occasionally feel rushed.", observer: "VP Okafor" },
      { date: "2026-02-11", scores: [4,4,4,4,4,4,4,4,4,4], strengths: "Model classroom — every domain at exemplary.", growthAreas: "Nothing critical; share best practices with peers.", observer: "Coach Mills" },
      { date: "2026-03-10", scores: [4,4,4,4,4,4,4,4,4,4], strengths: "Consistent excellence across all domains.", growthAreas: "Consider leading a professional development session on ratio." },
    ]},
    { name: "James Mitchell", subject: "Math",    gradeLevel: ["6","7"], schoolId: lincoln.id, observations: [
      { date: "2026-01-18", scores: [4,3,4,3,4,3,4,4,3,4], strengths: "Veteran presence; students know exactly what to do.", growthAreas: "WTD and F15 Fluency still at 3.", observer: "Coach Mills" },
      { date: "2026-02-22", scores: [4,4,4,4,4,4,4,4,4,4], strengths: "Every domain exemplary. WTD cycle was particularly sharp.", growthAreas: "Nothing to correct. Document this lesson for future PD use.", observer: "Principal Rivera" },
      { date: "2026-03-19", scores: [4,4,4,4,4,4,4,4,4,4], strengths: "Excellent leadership presence.", growthAreas: "Continue mentoring. Explore instructional leadership opportunities." },
    ]},
    { name: "Rachel Kim",     subject: "English", gradeLevel: ["8"],     schoolId: lincoln.id, observations: [
      { date: "2026-01-10", scores: [3,3,2,3,3,2,3,3,2,3], strengths: "Clear routines; students feel safe and engaged.", growthAreas: "Ratio and annotations are areas of growth.", observer: "Principal Rivera" },
      { date: "2026-02-14", scores: [3,3,3,3,3,3,3,3,3,3], strengths: "All domains at 3 — great consistency.", growthAreas: "Look for moments to push toward exemplary.", observer: "Coach Mills" },
      { date: "2026-03-12", scores: [3,3,3,4,3,3,3,3,3,3], strengths: "Joy was exemplary today — genuine celebration culture.", growthAreas: "Replicate those joy conditions across other domains." },
    ]},
    { name: "Derek Thompson", subject: "History", gradeLevel: ["8"],     schoolId: lincoln.id, observations: [
      { date: "2026-01-22", scores: [2,1,2,2,2,2,1,2,1,2], strengths: "Eager and responsive to feedback.", growthAreas: "WTD cycle and F15 Launch are critical gaps.", observer: "Coach Mills" },
      { date: "2026-02-25", scores: [2,2,2,2,2,2,2,2,2,2], strengths: "All domains at 2 — steady progress since January.", growthAreas: "Moving from 2 to 3 requires intentionality.", observer: "Principal Rivera" },
      { date: "2026-03-20", scores: [2,2,3,2,2,2,2,2,2,2], strengths: "Ratio showed a real 3 today — best lesson of the year.", growthAreas: "Build on that ratio success." },
    ]},
    { name: "Anthony Clark",  subject: "Art",     gradeLevel: ["6","7","8"], schoolId: lincoln.id, observations: [
      { date: "2026-01-28", scores: [3,2,3,4,3,2,3,2,3,3], strengths: "Joy and presence are consistent strengths.", growthAreas: "WTD cycle and F15 Fluency at 2.", observer: "Coach Mills" },
      { date: "2026-02-24", scores: [3,3,3,4,3,3,3,3,3,3], strengths: "WTD and F15 Fluency improved significantly.", growthAreas: "Ready to target one additional exemplary domain.", observer: "Principal Rivera" },
      { date: "2026-03-24", scores: [3,3,3,4,3,3,3,3,3,3], strengths: "Consistent across the board. Strong and reliable.", growthAreas: "Joy naturally exemplary — coach joy into other domains." },
    ]},

    /* ── Washington High School ── */
    { name: "Marcus Williams", subject: "Math",    gradeLevel: ["9","10"],  schoolId: washington.id, observations: [
      { date: "2026-01-15", scores: [1,1,2,1,2,1,2,1,2,1], strengths: "Shows genuine care for students.", growthAreas: "Routines are unclear; voice projection needs work.", observer: "VP Okafor" },
      { date: "2026-02-20", scores: [2,2,2,2,2,2,2,2,2,2], strengths: "Entry routine improving. Students beginning to follow expectations.", growthAreas: "WTD cycle still reactive.", observer: "VP Okafor" },
      { date: "2026-03-18", scores: [2,2,3,2,2,2,2,2,3,2], strengths: "Engagement picking up. Annotations notebook habit is a bright spot.", growthAreas: "Confident presence still inconsistent." },
    ]},
    { name: "David Chen",      subject: "History", gradeLevel: ["10"],      schoolId: washington.id, observations: [
      { date: "2026-01-22", scores: [3,3,2,3,3,2,3,3,2,3], strengths: "Knows his content deeply; students trust him.", growthAreas: "Ratio and engagement need more structured student talk protocols.", observer: "VP Okafor" },
      { date: "2026-02-25", scores: [3,3,3,3,3,3,3,3,3,3], strengths: "Consistent across all domains. Great improvement in F15 Fluency.", growthAreas: "Push toward 4s in ratio — try debate or structured partner work.", observer: "VP Okafor" },
      { date: "2026-03-20", scores: [3,3,3,3,3,3,3,3,3,3], strengths: "Solid and reliable. Culture is positive and purposeful.", growthAreas: "Ready for a stretch goal: aim for one exemplary domain." },
    ]},
    { name: "Thomas Garcia",   subject: "History", gradeLevel: ["11"],      schoolId: washington.id, observations: [
      { date: "2026-01-28", scores: [4,4,3,4,3,4,3,4,3,4], strengths: "Masterful presence; students deeply engaged.", growthAreas: "Ratio and F15 Launch are the two 3s.", observer: "VP Okafor" },
      { date: "2026-02-24", scores: [4,4,4,4,4,4,4,4,3,4], strengths: "Annotations at 3 — only outlier. Remarkable consistency.", growthAreas: "Push annotations to 4.", observer: "VP Okafor" },
      { date: "2026-03-24", scores: [4,4,4,4,4,4,4,4,4,4], strengths: "Perfect across all domains. A truly exemplary teacher.", growthAreas: "Formal instructional leadership role." },
    ]},
    { name: "Monica Alvarez",  subject: "Science", gradeLevel: ["11","12"], schoolId: washington.id, observations: [
      { date: "2026-01-08", scores: [4,3,3,4,4,3,4,3,4,4], strengths: "Presence and joy are standout strengths.", growthAreas: "WTD and F15 Fluency at 3.", observer: "VP Okafor" },
      { date: "2026-02-11", scores: [4,4,4,4,4,4,4,4,4,4], strengths: "All exemplary. Exceptional lesson observed.", growthAreas: "Continue at this level.", observer: "VP Okafor" },
      { date: "2026-03-10", scores: [4,4,4,4,4,4,4,4,4,4], strengths: "Consistently outstanding across every domain.", growthAreas: "Peer coaching and formal leadership are natural next steps." },
    ]},
    { name: "Carlos Reyes",    subject: "PE",      gradeLevel: ["9","10","11","12"], schoolId: washington.id, observations: [
      { date: "2026-01-18", scores: [3,3,3,4,3,3,3,3,2,3], strengths: "Joy is exemplary — PE culture is a school highlight.", growthAreas: "Annotations still at 2.", observer: "VP Okafor" },
      { date: "2026-02-22", scores: [3,3,4,4,3,3,3,3,3,3], strengths: "Ratio improving — more student-led demonstrations.", growthAreas: "Continue ratio growth.", observer: "VP Okafor" },
      { date: "2026-03-19", scores: [4,3,4,4,4,3,4,3,3,4], strengths: "Confident presence and ratio at exemplary.", growthAreas: "WTD cycle and fluency are next targets." },
    ]},
    { name: "Paul Wright",     subject: "Math",    gradeLevel: ["12"],      schoolId: washington.id, observations: [
      { date: "2026-01-25", scores: [4,4,4,3,4,4,4,4,3,4], strengths: "Veteran excellence. Math instruction is masterful.", growthAreas: "Joy and annotations at 3.", observer: "VP Okafor" },
      { date: "2026-02-28", scores: [4,4,4,4,4,4,4,4,4,4], strengths: "Full exemplary across all domains.", growthAreas: "Model this practice.", observer: "VP Okafor" },
      { date: "2026-03-22", scores: [4,4,4,4,4,4,4,4,4,4], strengths: "Consistent excellence. A cornerstone of our instructional team.", growthAreas: "Peer coaching and instructional leadership opportunities." },
    ]},

    /* ── Roosevelt Elementary ── */
    { name: "Amanda Torres",   subject: "English",    gradeLevel: ["5"],       schoolId: roosevelt.id, observations: [
      { date: "2026-01-12", scores: [1,2,1,2,1,2,1,1,2,1], strengths: "Students like her; energy is positive.", growthAreas: "Routines and systems need significant tightening.", observer: "Principal Rivera" },
      { date: "2026-02-16", scores: [2,2,2,2,2,2,2,2,2,2], strengths: "Entry routine much improved after coaching.", growthAreas: "All domains hovering at 2.", observer: "Coach Mills" },
      { date: "2026-03-14", scores: [2,2,2,3,2,2,2,2,2,2], strengths: "Joy was a genuine 3 today!", growthAreas: "Hold the joy standard." },
    ]},
    { name: "Linda Roberts",   subject: "Science",    gradeLevel: ["4"],       schoolId: roosevelt.id, observations: [
      { date: "2026-01-20", scores: [2,3,2,2,3,2,3,2,3,2], strengths: "Great F15 entry and launch — clear strengths.", growthAreas: "Confident presence and ratio need development.", observer: "Principal Rivera" },
      { date: "2026-02-18", scores: [3,3,3,3,3,3,3,3,3,3], strengths: "All domains at proficient — nice jump from January.", growthAreas: "Sustain and deepen.", observer: "Coach Mills" },
      { date: "2026-03-16", scores: [3,3,3,3,3,3,3,3,3,3], strengths: "Consistent and reliable. Classroom culture feels safe and focused.", growthAreas: "Challenge herself to differentiate instruction more intentionally." },
    ]},
    { name: "Kevin Nguyen",    subject: "PE",         gradeLevel: ["K","1","2"],   schoolId: roosevelt.id, observations: [
      { date: "2026-01-25", scores: [3,2,3,4,2,3,2,2,1,2], strengths: "Joy is a genuine strength — kids love PE with him.", growthAreas: "Annotations and academic monitoring feel underutilized.", observer: "Coach Mills" },
      { date: "2026-02-28", scores: [3,3,3,4,3,3,3,2,2,2], strengths: "WTD cycle and F15 much improved. Joy remains excellent.", growthAreas: "Annotations still a 2.", observer: "Principal Rivera" },
      { date: "2026-03-22", scores: [3,3,3,4,3,3,3,3,2,3], strengths: "Strong showing across the board.", growthAreas: "Push annotations to 3." },
    ]},
    { name: "Olivia Brown",    subject: "Art",        gradeLevel: ["K","1","2"],   schoolId: roosevelt.id, observations: [
      { date: "2026-01-14", scores: [1,1,1,2,1,1,1,1,1,1], strengths: "Creative spirit; genuine love of art visible.", growthAreas: "Classroom management is the primary barrier.", observer: "Principal Rivera" },
      { date: "2026-02-17", scores: [2,1,2,2,2,2,1,2,2,2], strengths: "Entry improved after check-in. Joy up slightly.", growthAreas: "WTD cycle and F15 Launch are still 1s.", observer: "Coach Mills" },
      { date: "2026-03-15", scores: [2,2,2,3,2,2,2,2,2,2], strengths: "Joy was a real 3 today!", growthAreas: "Keep building on joy." },
    ]},
    { name: "Brian Foster",    subject: "Math",       gradeLevel: ["3","4"],       schoolId: roosevelt.id, observations: [
      { date: "2026-01-15", scores: [2,2,3,2,2,2,3,2,2,2], strengths: "F15 Launch and F15 Fluency are consistent strengths.", growthAreas: "Confident presence and ratio still developing.", observer: "Coach Mills" },
      { date: "2026-02-20", scores: [3,2,3,2,3,2,3,2,3,2], strengths: "Ratio and F15 Entry improving.", growthAreas: "WTD and Joy still at 2.", observer: "Principal Rivera" },
      { date: "2026-03-18", scores: [3,3,3,3,3,3,3,3,3,3], strengths: "All domains at 3 — real growth since January.", growthAreas: "Sustain and begin targeting one domain for exemplary." },
    ]},
    { name: "Stephanie Lee",   subject: "Music",      gradeLevel: ["K","1","2"],   schoolId: roosevelt.id, observations: [
      { date: "2026-01-12", scores: [3,3,4,4,3,3,4,3,3,3], strengths: "Ratio and joy are standouts. Music class is a model for culture.", growthAreas: "Consistent presence and WTD cycle could be sharpened.", observer: "Principal Rivera" },
      { date: "2026-02-16", scores: [4,3,4,4,4,3,4,3,3,4], strengths: "Nearly all exemplary.", growthAreas: "Focus on LP and Mks precision.", observer: "Coach Mills" },
      { date: "2026-03-14", scores: [4,4,4,4,4,4,4,4,3,4], strengths: "One of our strongest teachers.", growthAreas: "Embed notebook habits into music journals." },
    ]},
    { name: "Nicole Harris",   subject: "Special Ed", gradeLevel: ["3","4","5"],   schoolId: roosevelt.id, observations: [
      { date: "2026-01-20", scores: [2,2,2,2,2,2,2,2,2,2], strengths: "Caring and attentive to student needs.", growthAreas: "All domains at 2.", observer: "Coach Mills" },
      { date: "2026-02-18", scores: [2,2,3,2,2,2,2,2,3,2], strengths: "Ratio and annotations are at 3 — real bright spots.", growthAreas: "Translate that success to other domains.", observer: "Principal Rivera" },
      { date: "2026-03-16", scores: [3,2,3,3,3,2,3,2,3,3], strengths: "Four domains now at 3 — great trajectory.", growthAreas: "WTD and F15 Fluency are the remaining 2s." },
    ]},
    { name: "Julia Morgan",    subject: "English",    gradeLevel: ["1"],           schoolId: roosevelt.id, observations: [
      { date: "2026-01-14", scores: [1,1,2,2,1,2,1,1,2,1], strengths: "Warm relationship with young students.", growthAreas: "Classroom management needs serious attention.", observer: "Principal Rivera" },
      { date: "2026-02-17", scores: [2,2,2,2,2,2,2,2,2,2], strengths: "Entry is much better — big win after focused coaching.", growthAreas: "All domains at 2.", observer: "Coach Mills" },
      { date: "2026-03-15", scores: [2,2,2,3,2,2,2,2,2,2], strengths: "Joy at 3 — students genuinely celebrated a reading milestone.", growthAreas: "Harness that joy energy." },
    ]},
  ];

  for (const t of TEACHERS) {
    const [dbTeacher] = await db.insert(teachers).values({
      name: t.name,
      subject: t.subject,
      gradeLevel: t.gradeLevel,
      schoolId: t.schoolId,
    }).returning();

    for (const o of t.observations) {
      const [dbObs] = await db.insert(observations).values({
        teacherId: dbTeacher.id,
        quarterId: q1.id,
        date: o.date,
        strengths: o.strengths ?? null,
        growthAreas: o.growthAreas ?? null,
        observer: o.observer ?? "Principal Rivera",
      }).returning();

      const scoreRows = ALL_SLUGS.map((slug, i) => ({
        observationId: dbObs.id,
        domainSlug: slug,
        score: o.scores[i],
      }));
      await db.insert(observationScores).values(scoreRows);
    }
  }

  console.log(`  ✓ Seeded ${TEACHERS.length} teachers across 3 schools`);
  console.log("✅ Seed complete!");
  await pool.end();
}

seed().catch((err) => { console.error("Seed failed:", err); process.exit(1); });
