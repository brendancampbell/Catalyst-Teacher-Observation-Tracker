import { db, pool } from "@workspace/db";
import {
  people, observations, observationScores,
  rubricQuarters,
} from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";

// ── Production safety guard ──────────────────────────────────────────────────
// Fails closed: any DATABASE_URL whose hostname is not localhost or 127.0.0.1
// is treated as a remote/production database and will be rejected.
// Override only possible via explicit DEV_SEED_FORCE=true (never set in prod).
const nodeEnv        = process.env.NODE_ENV ?? "";
const dbUrl          = process.env.DATABASE_URL ?? "";
const forceOverride  = process.env.DEV_SEED_FORCE === "true";

function isLocalDb(url: string): boolean {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

const isProdEnv   = nodeEnv === "production";
const isRemoteDb  = !isLocalDb(dbUrl);

if ((isProdEnv || isRemoteDb) && !forceOverride) {
  console.error(
    "ERROR: seed-dev-extra-obs refuses to run outside a local development environment.\n" +
    `  NODE_ENV       = ${nodeEnv || "(unset)"}\n` +
    `  DATABASE_URL hostname is ${isRemoteDb ? "remote (non-localhost)" : "local"}\n` +
    "  To override for a trusted non-local dev DB, set DEV_SEED_FORCE=true (never use in production)."
  );
  process.exit(1);
}

// ── Score distributions ───────────────────────────────────────────────────────
const SCORES = [0, 0.5, 1.0] as const;

function rLowScore(): number {
  const r = Math.random();
  if (r < 0.35) return SCORES[0];
  if (r < 0.70) return SCORES[1];
  return SCORES[2];
}

function rScore(): number {
  const r = Math.random();
  if (r < 0.15) return SCORES[0];
  if (r < 0.50) return SCORES[1];
  return SCORES[2];
}

function rDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

const DOMAIN_SLUGS = [
  "confident_presence", "wtd_cycle", "ratio_engagement", "joy",
  "f15_entry", "f15_fluency", "f15_launch",
  "lp_mks", "annotations", "academic_mon",
];

// ── Main ─────────────────────────────────────────────────────────────────────
async function seedExtraObs() {
  console.log("=== SEED-DEV-EXTRA-OBS START ===");

  const [rubricSet] = await db
    .select({ id: rubricQuarters.id, schoolYearId: rubricQuarters.schoolYearId })
    .from(rubricQuarters)
    .where(and(eq(rubricQuarters.slug, "Q1"), eq(rubricQuarters.isActive, true)))
    .limit(1);

  if (!rubricSet) {
    console.error("ERROR: No active Q1 rubric set found. Run the base seed and dev seed first.");
    await pool.end();
    process.exit(1);
  }

  const teachers = await db
    .select({
      employeeId: people.employeeId,
      schoolId:   people.schoolId,
      firstName:  people.firstName,
      lastName:   people.lastName,
    })
    .from(people)
    .where(
      and(
        eq(people.role, "NO_ACCESS"),
        eq(people.includeInFeedbackTracker, true)
      )
    );

  if (teachers.length === 0) {
    console.error("ERROR: No teachers found. Run the dev seed first (pnpm --filter api-server seed-dev).");
    await pool.end();
    process.exit(1);
  }

  console.log(`Found ${teachers.length} teachers. Inserting extra observations…`);

  let totalObs = 0;

  for (const teacher of teachers) {
    const useLowScore = Math.random() < 0.70;
    const scoreFn     = useLowScore ? rLowScore : rScore;
    const numObs      = 3 + Math.floor(Math.random() * 3);

    for (let i = 0; i < numObs; i++) {
      const daysAgo     = Math.floor(Math.random() * 90);
      const isWalkthrough = Math.random() < 0.3;

      const [obs] = await db.insert(observations).values({
        observedEmployeeId: teacher.employeeId,
        schoolId:           teacher.schoolId ?? undefined,
        schoolYearId:       rubricSet.schoolYearId,
        rubricSetId:        rubricSet.id,
        date:               rDate(daysAgo),
        isWalkthrough,
        strengths:    isWalkthrough ? null : "Continued growth in instructional routines.",
        growthAreas:  isWalkthrough ? null : "Focus on increasing student ratio and academic monitoring.",
        status:       "published",
      }).returning();

      await db.insert(observationScores).values(
        DOMAIN_SLUGS.map((slug) => ({
          observationId: obs.id,
          domainSlug:    slug,
          score:         scoreFn(),
        }))
      );

      totalObs++;
    }
  }

  console.log(`✓ ${totalObs} observations inserted across ${teachers.length} teachers`);
  console.log("=== SEED-DEV-EXTRA-OBS COMPLETE ===");
  await pool.end();
}

seedExtraObs().catch((err) => {
  console.error("seed-dev-extra-obs failed:", err);
  process.exit(1);
});
