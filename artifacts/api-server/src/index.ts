import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { bootstrapAdmin } from "./lib/bootstrap-admin";
import { cleanupExpiredQuotaGrants } from "./lib/quota-grant-cleanup.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function ensureSessionTable(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "sid"    varchar      NOT NULL COLLATE "default",
        "sess"   json         NOT NULL,
        "expire" timestamp(6) NOT NULL,
        CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
      );
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
    `);
    logger.info("Session table ready");
  } finally {
    client.release();
  }
}

async function ensureSchools(): Promise<void> {
  const client = await pool.connect();
  try {
    /* ── Step 1: Rename name → display_name if still on old schema ── */
    const { rows: nameColRows } = await client.query<{ exists: boolean }>(`
      SELECT EXISTS(
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'schools' AND column_name = 'name'
      ) AS exists
    `);
    if (nameColRows[0].exists) {
      logger.info("Schools: renaming name → display_name");
      await client.query(`ALTER TABLE schools RENAME COLUMN name TO display_name`);
    }

    /* ── Step 2: Add full_name if missing ── */
    const { rows: fnColRows } = await client.query<{ exists: boolean }>(`
      SELECT EXISTS(
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'schools' AND column_name = 'full_name'
      ) AS exists
    `);
    if (!fnColRows[0].exists) {
      logger.info("Schools: adding full_name column");
      await client.query(`ALTER TABLE schools ADD COLUMN full_name TEXT`);
    }

    /* ── Step 3: Add abbreviation if missing ── */
    const { rows: abbrColRows } = await client.query<{ exists: boolean }>(`
      SELECT EXISTS(
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'schools' AND column_name = 'abbreviation'
      ) AS exists
    `);
    if (!abbrColRows[0].exists) {
      logger.info("Schools: adding abbreviation column");
      await client.query(`ALTER TABLE schools ADD COLUMN abbreviation TEXT`);
    }

    /* ── Step 4: Add unique constraint on abbreviation (required for ON CONFLICT) ── */
    const { rows: uqRows } = await client.query<{ exists: boolean }>(`
      SELECT EXISTS(
        SELECT 1 FROM pg_constraint WHERE conname = 'schools_abbreviation_unique'
      ) AS exists
    `);
    if (!uqRows[0].exists) {
      await client.query(`ALTER TABLE schools ADD CONSTRAINT schools_abbreviation_unique UNIQUE (abbreviation)`);
    }

    /* ── Step 5: Seed the 52 canonical schools (idempotent by abbreviation) ── */
    const SCHOOLS: Array<[string, string, string, string, string]> = [
      ["Camden Prep Copewood ES",          "Camden Prep Copewood Elementary School",               "CP_CES",   "Camden",    "ES"],
      ["Camden Prep Copewood MS",          "Camden Prep Copewood Middle School",                   "CP_CMS",   "Camden",    "MS"],
      ["Camden Prep HS",                   "Camden Prep High School",                              "CP_HS",    "Camden",    "HS"],
      ["Camden Prep Mt Ephraim ES",        "Camden Prep Mt. Ephraim Elementary School",            "CP_MES",   "Camden",    "ES"],
      ["Camden Prep Mt Ephraim MS",        "Camden Prep Mt. Ephraim Middle School",                "CP_MMS",   "Camden",    "MS"],
      ["NSA Alexander Street ES",          "North Star Academy Alexander Street Elementary School","NSA_AES",  "Newark",    "ES"],
      ["NSA Central Avenue MS",            "North Star Academy Central Avenue Middle School",      "NSA_CMS",  "Newark",    "MS"],
      ["NSA Clinton Hill MS",              "North Star Academy Clinton Hill Middle School",        "NSA_CHMS", "Newark",    "MS"],
      ["NSA Downtown MS",                  "North Star Academy Downtown Middle School",            "NSA_DTMS", "Newark",    "MS"],
      ["NSA Fairmount ES",                 "North Star Academy Fairmount Elementary School",       "NSA_FES",  "Newark",    "ES"],
      ["NSA Liberty ES",                   "North Star Academy Liberty Elementary School",         "NSA_LES",  "Newark",    "ES"],
      ["NSA Lincoln Park ES",              "North Star Academy Lincoln Park Elementary School",    "NSA_LPES", "Newark",    "ES"],
      ["NSA Lincoln Park HS",              "North Star Academy Lincoln Park High School",          "NSA_LPHS", "Newark",    "HS"],
      ["NSA Lincoln Park MS",              "North Star Academy Lincoln Park Middle School",        "NSA_LPMS", "Newark",    "MS"],
      ["NSA Vailsburg ES",                 "North Star Academy Vailsburg Elementary School",       "NSA_VES",  "Newark",    "ES"],
      ["NSA Vailsburg MS",                 "North Star Academy Vailsburg Middle School",           "NSA_VMS",  "Newark",    "MS"],
      ["NSA Washington Park HS",           "North Star Academy Washington Park High School",       "NSA_WPHS", "Newark",    "HS"],
      ["NSA West Side Park ES",            "North Star Academy West Side Park Elementary School",  "NSA_WPES", "Newark",    "ES"],
      ["NSA West Side Park MS",            "North Star Academy West Side Park Middle School",      "NSA_WMS",  "Newark",    "MS"],
      ["RP Andrews Campus ES",             "Rochester Prep Andrews Campus Elementary School",      "RP_ACES",  "Rochester", "ES"],
      ["RP Brooks Campus MS",              "Rochester Prep Brooks Campus Middle School",           "RP_BCMS",  "Rochester", "MS"],
      ["RP Chili Campus MS",               "Rochester Prep Chili Campus Middle School",            "RP_CCMS",  "Rochester", "MS"],
      ["Rochester Prep HS",                "Rochester Prep High School",                           "RP_HS",    "Rochester", "HS"],
      ["RP Jay Campus ES",                 "Rochester Prep Jay Campus Elementary School",          "RP_JCES",  "Rochester", "ES"],
      ["RP St. Jacob Campus ES",           "Rochester Prep St. Jacob Campus Elementary School",   "RP_SJCES", "Rochester", "ES"],
      ["RP St. Jacob Campus MS",           "Rochester Prep St. Jacob Campus Middle School",       "RP_SJCMS", "Rochester", "MS"],
      ["Roxbury Prep Dorchester MS",       "Roxbury Prep Dorchester",                              "RXP_DC",   "Boston",    "MS"],
      ["Roxbury Prep HS",                  "Roxbury Prep High School",                             "RXP_HS",   "Boston",    "HS"],
      ["Roxbury Prep Proctor Street MS",   "Roxbury Prep Proctor Street",                          "RXP_PS",   "Boston",    "MS"],
      ["Uncommon Bed-Stuy East MS",        "Uncommon Bed-Stuy East Middle School",                 "NYC_UBEM", "NYC",       "MS"],
      ["Uncommon Bed-Stuy West ES",        "Uncommon Bed-Stuy West Elementary School",             "NYC_UBWE", "NYC",       "ES"],
      ["Uncommon Bed-Stuy West MS",        "Uncommon Bed-Stuy West Middle School",                 "NYC_UBWM", "NYC",       "MS"],
      ["Uncommon Brownsville North ES",    "Uncommon Brownsville North Elementary School",         "NYC_UBNE", "NYC",       "ES"],
      ["Uncommon Brownsville North MS",    "Uncommon Brownsville North Middle School",              "NYC_UBNM", "NYC",       "MS"],
      ["Uncommon Brownsville South ES",    "Uncommon Brownsville South Elementary School",         "NYC_UBSE", "NYC",       "ES"],
      ["Uncommon Brownsville South MS",    "Uncommon Brownsville South Middle School",              "NYC_UBSM", "NYC",       "MS"],
      ["Uncommon Canarsie ES",             "Uncommon Canarsie Elementary School",                  "NYC_UCES", "NYC",       "ES"],
      ["Uncommon Canarsie MS",             "Uncommon Canarsie Middle School",                      "NYC_UCMS", "NYC",       "MS"],
      ["Uncommon Charter HS",              "Uncommon Charter High School",                         "NYC_UCHS", "NYC",       "HS"],
      ["Uncommon Collegiate Charter HS",   "Uncommon Collegiate Charter High School",              "NYC_UCC",  "NYC",       "HS"],
      ["Uncommon Crown Heights ES",        "Uncommon Crown Heights Elementary School",             "NYC_UCHE", "NYC",       "ES"],
      ["Uncommon Excellence Boys ES",      "Uncommon Excellence Boys Elementary School",           "NYC_UEBE", "NYC",       "ES"],
      ["Uncommon Excellence Boys MS",      "Uncommon Excellence Boys Middle School",               "NYC_UEBM", "NYC",       "MS"],
      ["Uncommon Excellence Girls ES",     "Uncommon Excellence Girls Elementary School",          "NYC_UEGE", "NYC",       "ES"],
      ["Uncommon Excellence Girls MS",     "Uncommon Excellence Girls Middle School",              "NYC_UEGM", "NYC",       "MS"],
      ["Uncommon Kings ES",                "Uncommon Kings Elementary School",                     "NYC_UKES", "NYC",       "ES"],
      ["Uncommon Kings MS",                "Uncommon Kings Middle School",                         "NYC_UKMS", "NYC",       "MS"],
      ["Uncommon Leadership Charter HS",   "Uncommon Leadership Charter High School",              "NYC_ULC",  "NYC",       "HS"],
      ["Uncommon Ocean Hill MS",           "Uncommon Ocean Hill Middle School",                    "NYC_UOHM", "NYC",       "MS"],
      ["Uncommon Prep Charter HS",         "Uncommon Preparatory Charter High School",             "NYC_UPC",  "NYC",       "HS"],
      ["Uncommon Williamsburg ES",         "Uncommon Williamsburg Elementary School",              "NYC_UWES", "NYC",       "ES"],
      ["Uncommon Williamsburg MS",         "Uncommon Williamsburg Middle School",                  "NYC_UWMS", "NYC",       "MS"],
    ];

    for (const [displayName, fullName, abbreviation, region, gradeSpan] of SCHOOLS) {
      await client.query(`
        INSERT INTO schools (display_name, full_name, abbreviation, region, grade_span)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (abbreviation) DO UPDATE
          SET display_name = EXCLUDED.display_name,
              full_name    = EXCLUDED.full_name,
              region       = EXCLUDED.region,
              grade_span   = EXCLUDED.grade_span
      `, [displayName, fullName, abbreviation, region, gradeSpan]);
    }

    /* ── Step 6: Enforce NOT NULL once all rows have values ── */
    await client.query(`
      ALTER TABLE schools
        ALTER COLUMN full_name    SET NOT NULL,
        ALTER COLUMN abbreviation SET NOT NULL
    `);

    /* ── Step 7: Add is_home_office column if missing ── */
    const { rows: hoColRows } = await client.query<{ exists: boolean }>(`
      SELECT EXISTS(
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'schools' AND column_name = 'is_home_office'
      ) AS exists
    `);
    if (!hoColRows[0].exists) {
      logger.info("Schools: adding is_home_office column");
      await client.query(`ALTER TABLE schools ADD COLUMN IF NOT EXISTS is_home_office BOOLEAN NOT NULL DEFAULT FALSE`);
    }

    /* ── Step 8: Ensure the Home Office pseudo-school row exists ── */
    const { rows: hoRows } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM schools WHERE is_home_office = TRUE) AS exists`,
    );
    if (!hoRows[0].exists) {
      logger.info("Schools: inserting Home Office pseudo-school");
      await client.query(`
        INSERT INTO schools (display_name, full_name, abbreviation, region, grade_span, is_home_office, is_active)
        VALUES ('Home Office', 'Home Office', 'HO', '', '', TRUE, TRUE)
        ON CONFLICT (abbreviation) DO UPDATE SET is_home_office = TRUE
      `);
    }

    /* ── Step 9: One-time cleanup — clear includeInFeedbackTracker for HO users ── */
    await client.query(`
      UPDATE people
         SET include_in_feedback_tracker = FALSE
       WHERE include_in_feedback_tracker = TRUE
         AND school_id IN (SELECT id FROM schools WHERE is_home_office = TRUE)
    `);

    logger.info("Schools: schema and seed complete");
  } finally {
    client.release();
  }
}

async function ensureChatTables(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id          SERIAL PRIMARY KEY,
        employee_id TEXT NOT NULL REFERENCES people(employee_id) ON DELETE CASCADE,
        title       TEXT NOT NULL DEFAULT 'New Chat',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS chat_sessions_employee_id_idx ON chat_sessions(employee_id);
      CREATE INDEX IF NOT EXISTS chat_sessions_updated_at_idx  ON chat_sessions(updated_at DESC);
      CREATE TABLE IF NOT EXISTS chat_messages (
        id         SERIAL PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role       TEXT NOT NULL,
        content    TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS chat_messages_session_id_idx ON chat_messages(session_id);
    `);
    /* Add rubric_set_slug column if not yet present (idempotent) */
    await client.query(`
      ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS rubric_set_slug TEXT;
    `);
    /* Add instant_analysis_structured column if not yet present (idempotent) */
    await client.query(`
      ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS instant_analysis_structured JSONB;
    `);
    logger.info("Chat tables ready");
  } finally {
    client.release();
  }
}

/* ── Periodic cleanup: delete quota grant rows expired > 7 days ago ──────────
   Runs once at startup and then every hour. Uses .unref() so the interval
   never prevents a clean process exit.
   Implementation lives in ./lib/quota-grant-cleanup (exported for testing). */
const QUOTA_GRANT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; /* 1 hour */
/* cleanupExpiredQuotaGrants is imported from ./lib/quota-grant-cleanup */

ensureSessionTable()
  .then(() => ensureSchools())
  .then(() => ensureChatTables())
  .then(() => bootstrapAdmin())
  .then(() => {
    /* Kick off first cleanup immediately, then repeat every hour */
    cleanupExpiredQuotaGrants().catch((err) =>
      logger.warn({ err, event: "quota_grant_cleanup_failed" }, "Quota grant cleanup failed"),
    );
    setInterval(() => {
      cleanupExpiredQuotaGrants().catch((err) =>
        logger.warn({ err, event: "quota_grant_cleanup_failed" }, "Quota grant cleanup failed"),
      );
    }, QUOTA_GRANT_CLEANUP_INTERVAL_MS).unref();

    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening");
    });
  })
  .catch((err) => {
    logger.error({ err }, "Startup failed — aborting");
    process.exit(1);
  });
