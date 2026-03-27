import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import {
  teachers, rubricQuarters, rubricCategories, rubricDomains,
  observations, observationScores,
} from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

async function seed() {
  console.log("🌱 Seeding database...");

  // Clear existing data
  await db.delete(observationScores);
  await db.delete(observations);
  await db.delete(rubricDomains);
  await db.delete(rubricCategories);
  await db.delete(rubricQuarters);
  await db.delete(teachers);
  console.log("  ✓ Cleared existing data");

  // ── Q1 Rubric ────────────────────────────────────────────────────
  const [q1] = await db.insert(rubricQuarters).values({ slug: "Q1", name: "Quarter 1", isActive: true }).returning();
  console.log("  ✓ Created Q1 rubric quarter");

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

  const domainSlugToId: Record<string, number> = {};
  for (let ci = 0; ci < CATEGORIES.length; ci++) {
    const cat = CATEGORIES[ci];
    const [dbCat] = await db.insert(rubricCategories)
      .values({ quarterId: q1.id, name: cat.name, displayOrder: ci })
      .returning();
    for (let di = 0; di < cat.domains.length; di++) {
      const dom = cat.domains[di];
      const [dbDom] = await db.insert(rubricDomains)
        .values({ categoryId: dbCat.id, name: dom.name, slug: dom.slug, displayOrder: di })
        .returning();
      domainSlugToId[dom.slug] = dbDom.id;
    }
  }
  console.log("  ✓ Created rubric categories and domains");

  // ── Teachers + Observations ────────────────────────────────────
  const ALL_SLUGS = [
    "confident_presence","wtd_cycle","ratio_engagement","joy",
    "f15_entry","f15_fluency","f15_launch",
    "lp_mks","annotations","academic_mon",
  ];

  type ObsInput = { date: string; scores: number[]; strengths?: string; growthAreas?: string; observer?: string };

  const TEACHERS: Array<{
    name: string; department: string; gradeLevel: string;
    observations: ObsInput[];
  }> = [
    { name: "Sarah Johnson",   department: "English",    gradeLevel: "6–8",  observations: [
      { date: "2026-01-10", scores: [2,2,2,3,2,3,2,2,2,3], strengths: "Strong rapport with students; consistent routines.", growthAreas: "Needs to increase student talk ratio and cold-calling.", observer: "VP Okafor" },
      { date: "2026-02-14", scores: [3,2,3,3,3,3,3,3,2,3], strengths: "WTD cycle improving; students respond well to joy moments.", growthAreas: "Annotations still inconsistent — push for 100% compliance.", observer: "Coach Mills" },
      { date: "2026-03-12", scores: [3,3,3,4,3,3,3,3,3,3], strengths: "Joy and engagement at high levels; culture feels warm and rigorous.", growthAreas: "Continue strengthening WTD cycle with faster pacing." },
    ]},
    { name: "Marcus Williams", department: "Math",       gradeLevel: "9–12",  observations: [
      { date: "2026-01-15", scores: [1,1,2,1,2,1,2,1,2,1], strengths: "Shows genuine care for students.", growthAreas: "Routines are unclear; voice projection needs work. Needs immediate coaching on entry and WTD.", observer: "Coach Mills" },
      { date: "2026-02-20", scores: [2,2,2,2,2,2,2,2,2,2], strengths: "Entry routine improving. Students beginning to follow expectations.", growthAreas: "WTD cycle still reactive. Work on proactive monitoring and narrating positives.", observer: "VP Okafor" },
      { date: "2026-03-18", scores: [2,2,3,2,2,2,2,2,3,2], strengths: "Engagement picking up in the middle of the lesson. Annotations notebook habit is a bright spot.", growthAreas: "Confident presence still inconsistent. Practice stand and scan." },
    ]},
    { name: "Priya Patel",     department: "Science",    gradeLevel: "6–8",  observations: [
      { date: "2026-01-08", scores: [4,3,4,4,4,3,4,3,4,4], strengths: "Exceptional engagement; students deeply invested in content.", growthAreas: "F15 Fluency pacing can occasionally feel rushed.", observer: "VP Okafor" },
      { date: "2026-02-11", scores: [4,4,4,4,4,4,4,4,4,4], strengths: "Model classroom — every domain at exemplary. Great job.", growthAreas: "Nothing critical; share best practices with peers.", observer: "Coach Mills" },
      { date: "2026-03-10", scores: [4,4,4,4,4,4,4,4,4,4], strengths: "Consistent excellence across all domains. Peer coaching candidate.", growthAreas: "Consider leading a professional development session on ratio." },
    ]},
    { name: "David Chen",      department: "History",    gradeLevel: "9–12",  observations: [
      { date: "2026-01-22", scores: [3,3,2,3,3,2,3,3,2,3], strengths: "Knows his content deeply; students trust him.", growthAreas: "Ratio and engagement need more structured student talk protocols.", observer: "Coach Mills" },
      { date: "2026-02-25", scores: [3,3,3,3,3,3,3,3,3,3], strengths: "Consistent across all domains. Great improvement in F15 Fluency.", growthAreas: "Push toward 4s in ratio — try debate or structured partner work.", observer: "VP Okafor" },
      { date: "2026-03-20", scores: [3,3,3,3,3,3,3,3,3,3], strengths: "Solid and reliable. Culture is positive and purposeful.", growthAreas: "Ready for a stretch goal: aim for one exemplary domain this cycle." },
    ]},
    { name: "Amanda Torres",   department: "English",    gradeLevel: "3–5",  observations: [
      { date: "2026-01-12", scores: [1,2,1,2,1,2,1,1,2,1], strengths: "Students like her; energy is positive.", growthAreas: "Routines and systems need significant tightening. Entry and presence are the priority.", observer: "VP Okafor" },
      { date: "2026-02-16", scores: [2,2,2,2,2,2,2,2,2,2], strengths: "Entry routine much improved after coaching. Students know expectations now.", growthAreas: "All domains hovering at 2 — need a targeted plan to build one to a 3.", observer: "Coach Mills" },
      { date: "2026-03-14", scores: [2,2,2,3,2,2,2,2,2,2], strengths: "Joy was a genuine 3 today — class celebration was on point!", growthAreas: "Hold the joy standard and replicate those conditions across other domains." },
    ]},
    { name: "James Mitchell",  department: "Math",       gradeLevel: "6–8",  observations: [
      { date: "2026-01-18", scores: [4,3,4,3,4,3,4,4,3,4], strengths: "Veteran presence; students know exactly what to do.", growthAreas: "WTD and F15 Fluency still at 3 — the gap between domains is interesting.", observer: "Coach Mills" },
      { date: "2026-02-22", scores: [4,4,4,4,4,4,4,4,4,4], strengths: "Every domain exemplary. WTD cycle was particularly sharp.", growthAreas: "Nothing to correct. Document this lesson for future PD use.", observer: "VP Okafor" },
      { date: "2026-03-19", scores: [4,4,4,4,4,4,4,4,4,4], strengths: "Excellent leadership presence. Serves as informal mentor for new teachers.", growthAreas: "Continue mentoring. Explore instructional leadership opportunities." },
    ]},
    { name: "Linda Roberts",   department: "Science",    gradeLevel: "3–5",  observations: [
      { date: "2026-01-20", scores: [2,3,2,2,3,2,3,2,3,2], strengths: "Great F15 entry and launch — clear strengths.", growthAreas: "Confident presence and ratio need development. Practice assertive voice.", observer: "VP Okafor" },
      { date: "2026-02-18", scores: [3,3,3,3,3,3,3,3,3,3], strengths: "All domains at proficient — nice jump from January. Momentum is real.", growthAreas: "Sustain and deepen. Target one area to push toward exemplary next cycle.", observer: "Coach Mills" },
      { date: "2026-03-16", scores: [3,3,3,3,3,3,3,3,3,3], strengths: "Consistent and reliable. Classroom culture feels safe and focused.", growthAreas: "Challenge herself to differentiate instruction more intentionally." },
    ]},
    { name: "Kevin Nguyen",    department: "PE",         gradeLevel: "K–2",  observations: [
      { date: "2026-01-25", scores: [3,2,3,4,2,3,2,2,1,2], strengths: "Joy is a genuine strength — kids love PE with him.", growthAreas: "Annotations and academic monitoring feel underutilized in a PE context. Adapt the frameworks.", observer: "Coach Mills" },
      { date: "2026-02-28", scores: [3,3,3,4,3,3,3,2,2,2], strengths: "WTD cycle and F15 much improved. Joy remains excellent.", growthAreas: "Annotations still a 2. Consider a PE-specific notebook protocol.", observer: "VP Okafor" },
      { date: "2026-03-22", scores: [3,3,3,4,3,3,3,3,2,3], strengths: "Strong showing across the board. Confident presence continues to grow.", growthAreas: "Push annotations to 3 — the PE adaptation is promising, keep going." },
    ]},
    { name: "Olivia Brown",    department: "Art",        gradeLevel: "K–2",  observations: [
      { date: "2026-01-14", scores: [1,1,1,2,1,1,1,1,1,1], strengths: "Creative spirit; genuine love of art visible.", growthAreas: "Classroom management is the primary barrier. Needs intensive coaching on routines and presence.", observer: "VP Okafor" },
      { date: "2026-02-17", scores: [2,1,2,2,2,2,1,2,2,2], strengths: "Entry improved after check-in. Joy up slightly.", growthAreas: "WTD cycle and F15 Launch are still 1s — focus coaching here for March.", observer: "Coach Mills" },
      { date: "2026-03-15", scores: [2,2,2,3,2,2,2,2,2,2], strengths: "Joy was a real 3 today — creative celebration worked well!", growthAreas: "Keep building on joy. Bridge that energy into structure and ratio." },
    ]},
    { name: "Thomas Garcia",   department: "History",    gradeLevel: "9–12", observations: [
      { date: "2026-01-28", scores: [4,4,3,4,3,4,3,4,3,4], strengths: "Masterful presence; students deeply engaged with material.", growthAreas: "Ratio and F15 Launch are the two 3s — both coachable areas.", observer: "Coach Mills" },
      { date: "2026-02-24", scores: [4,4,4,4,4,4,4,4,3,4], strengths: "Annotations at 3 — only outlier. Remarkable consistency.", growthAreas: "Push annotations to 4 by embedding a notebook protocol into his launch routine.", observer: "VP Okafor" },
      { date: "2026-03-24", scores: [4,4,4,4,4,4,4,4,4,4], strengths: "Perfect across all domains. A truly exemplary teacher.", growthAreas: "Formal instructional leadership role — champion for GBF practices school-wide." },
    ]},
    { name: "Rachel Kim",      department: "English",    gradeLevel: "6–8",  observations: [
      { date: "2026-01-10", scores: [3,3,2,3,3,2,3,3,2,3], strengths: "Clear routines; students feel safe and engaged.", growthAreas: "Ratio and annotations are areas of growth — structured protocols needed.", observer: "VP Okafor" },
      { date: "2026-02-14", scores: [3,3,3,3,3,3,3,3,3,3], strengths: "All domains at 3 — great consistency. F15 launch was strong.", growthAreas: "Look for moments to push toward exemplary; she's ready.", observer: "Coach Mills" },
      { date: "2026-03-12", scores: [3,3,3,4,3,3,3,3,3,3], strengths: "Joy was exemplary today — genuine celebration culture.", growthAreas: "Replicate those joy conditions across other domains." },
    ]},
    { name: "Brian Foster",    department: "Math",       gradeLevel: "3–5",  observations: [
      { date: "2026-01-15", scores: [2,2,3,2,2,2,3,2,2,2], strengths: "F15 Launch and F15 Fluency are consistent strengths.", growthAreas: "Confident presence and ratio still developing. Work on assertive stance and cold-calling.", observer: "Coach Mills" },
      { date: "2026-02-20", scores: [3,2,3,2,3,2,3,2,3,2], strengths: "Ratio and F15 Entry improving. Better use of checking for understanding.", growthAreas: "WTD and Joy still at 2 — consider injecting more energy and celebration.", observer: "VP Okafor" },
      { date: "2026-03-18", scores: [3,3,3,3,3,3,3,3,3,3], strengths: "All domains at 3 — real growth since January. Great job, Brian!", growthAreas: "Sustain and begin targeting one domain for exemplary." },
    ]},
    { name: "Monica Alvarez",  department: "Science",    gradeLevel: "9–12", observations: [
      { date: "2026-01-08", scores: [4,3,3,4,4,3,4,3,4,4], strengths: "Presence and joy are standout strengths. Students are fully invested.", growthAreas: "WTD and F15 Fluency at 3 — sharpen the cycle and oral fluency drills.", observer: "VP Okafor" },
      { date: "2026-02-11", scores: [4,4,4,4,4,4,4,4,4,4], strengths: "All exemplary. Exceptional lesson observed.", growthAreas: "Continue at this level. Mentoring others would multiply her impact.", observer: "Coach Mills" },
      { date: "2026-03-10", scores: [4,4,4,4,4,4,4,4,4,4], strengths: "Consistently outstanding across every domain.", growthAreas: "Peer coaching and formal leadership are natural next steps." },
    ]},
    { name: "Derek Thompson",  department: "History",    gradeLevel: "6–8",  observations: [
      { date: "2026-01-22", scores: [2,1,2,2,2,2,1,2,1,2], strengths: "Eager and responsive to feedback.", growthAreas: "WTD cycle and F15 Launch are critical gaps. Needs structured coaching plan.", observer: "Coach Mills" },
      { date: "2026-02-25", scores: [2,2,2,2,2,2,2,2,2,2], strengths: "All domains at 2 — steady progress since January.", growthAreas: "Moving from 2 to 3 requires intentionality. Pick one domain and focus there for March.", observer: "VP Okafor" },
      { date: "2026-03-20", scores: [2,2,3,2,2,2,2,2,2,2], strengths: "Ratio showed a real 3 today — best lesson of the year.", growthAreas: "Build on that ratio success. What conditions made it happen? Replicate them." },
    ]},
    { name: "Stephanie Lee",   department: "Music",      gradeLevel: "K–2",  observations: [
      { date: "2026-01-12", scores: [3,3,4,4,3,3,4,3,3,3], strengths: "Ratio and joy are standouts. Music class is a model for culture.", growthAreas: "Consistent presence and WTD cycle could be sharpened further.", observer: "VP Okafor" },
      { date: "2026-02-16", scores: [4,3,4,4,4,3,4,3,3,4], strengths: "Nearly all exemplary — F15 Fluency and LP & Mks are the 3s.", growthAreas: "Focus on LP and Mks precision to reach full exemplary status.", observer: "Coach Mills" },
      { date: "2026-03-14", scores: [4,4,4,4,4,4,4,4,3,4], strengths: "One of our strongest teachers. Annotations at 3 is the remaining gap.", growthAreas: "Embed notebook habits into music journals — close the final gap." },
    ]},
    { name: "Carlos Reyes",    department: "PE",         gradeLevel: "9–12", observations: [
      { date: "2026-01-18", scores: [3,3,3,4,3,3,3,3,2,3], strengths: "Joy is exemplary — PE culture is a school highlight.", growthAreas: "Annotations still at 2. Needs a PE-adapted notebook protocol.", observer: "Coach Mills" },
      { date: "2026-02-22", scores: [3,3,4,4,3,3,3,3,3,3], strengths: "Ratio improving — more student-led demonstrations.", growthAreas: "Continue ratio growth. Annotations now at 3 — strong improvement.", observer: "VP Okafor" },
      { date: "2026-03-19", scores: [4,3,4,4,4,3,4,3,3,4], strengths: "Confident presence and ratio at exemplary — impressive development.", growthAreas: "WTD cycle and fluency are next targets for exemplary." },
    ]},
    { name: "Nicole Harris",   department: "Special Ed", gradeLevel: "3–5",  observations: [
      { date: "2026-01-20", scores: [2,2,2,2,2,2,2,2,2,2], strengths: "Caring and attentive to student needs.", growthAreas: "All domains at 2. Needs coaching on routines and presence to move up.", observer: "VP Okafor" },
      { date: "2026-02-18", scores: [2,2,3,2,2,2,2,2,3,2], strengths: "Ratio and annotations are at 3 — real bright spots.", growthAreas: "Translate that success to other domains. Confident presence is next.", observer: "Coach Mills" },
      { date: "2026-03-16", scores: [3,2,3,3,3,2,3,2,3,3], strengths: "Four domains now at 3 — great trajectory. Clear growth.", growthAreas: "WTD and F15 Fluency are the remaining 2s. Schedule a targeted coaching session." },
    ]},
    { name: "Paul Wright",     department: "Math",       gradeLevel: "9–12", observations: [
      { date: "2026-01-25", scores: [4,4,4,3,4,4,4,4,3,4], strengths: "Veteran excellence. Math instruction is masterful.", growthAreas: "Joy and annotations at 3 — consider intentional celebration moments.", observer: "Coach Mills" },
      { date: "2026-02-28", scores: [4,4,4,4,4,4,4,4,4,4], strengths: "Full exemplary across all domains. Outstanding lesson.", growthAreas: "Model this practice. Encourage him to open his classroom to peer visits.", observer: "VP Okafor" },
      { date: "2026-03-22", scores: [4,4,4,4,4,4,4,4,4,4], strengths: "Consistent excellence. A cornerstone of our instructional team.", growthAreas: "Peer coaching, formal mentorship, and instructional leadership opportunities." },
    ]},
    { name: "Julia Morgan",    department: "English",    gradeLevel: "K–2",  observations: [
      { date: "2026-01-14", scores: [1,1,2,2,1,2,1,1,2,1], strengths: "Warm relationship with young students; they trust her.", growthAreas: "Classroom management needs serious attention. Priority: entry routine and presence.", observer: "VP Okafor" },
      { date: "2026-02-17", scores: [2,2,2,2,2,2,2,2,2,2], strengths: "Entry is much better — big win after focused coaching.", growthAreas: "All domains at 2 — the ceiling for the month. Plan for targeted domain growth in March.", observer: "Coach Mills" },
      { date: "2026-03-15", scores: [2,2,2,3,2,2,2,2,2,2], strengths: "Joy at 3 — students genuinely celebrated a reading milestone.", growthAreas: "Harness that joy energy. Translate celebration culture into other domains." },
    ]},
    { name: "Anthony Clark",   department: "Art",        gradeLevel: "6–8",  observations: [
      { date: "2026-01-28", scores: [3,2,3,4,3,2,3,2,3,3], strengths: "Joy and presence are consistent strengths — art room culture is vibrant.", growthAreas: "WTD cycle and F15 Fluency at 2 — need more structured protocols.", observer: "Coach Mills" },
      { date: "2026-02-24", scores: [3,3,3,4,3,3,3,3,3,3], strengths: "WTD and F15 Fluency improved significantly. Joy remains exemplary.", growthAreas: "Sustain this progress. Ready to target one additional exemplary domain.", observer: "VP Okafor" },
      { date: "2026-03-24", scores: [3,3,3,4,3,3,3,3,3,3], strengths: "Consistent across the board. Strong and reliable.", growthAreas: "Joy is naturally exemplary — now coach joy into other domains as a lever." },
    ]},
  ];

  for (const t of TEACHERS) {
    const [dbTeacher] = await db.insert(teachers).values({
      name: t.name,
      department: t.department,
      gradeLevel: t.gradeLevel,
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

  console.log("  ✓ Seeded 20 teachers with observations");
  console.log("✅ Seed complete!");
  await pool.end();
}

seed().catch((err) => { console.error("Seed failed:", err); process.exit(1); });
