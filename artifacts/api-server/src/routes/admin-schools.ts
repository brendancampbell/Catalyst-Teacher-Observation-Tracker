import { Router } from "express";
import { db, pool } from "@workspace/db";
import { schools, people } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireNetworkAdmin } from "../middleware/auth";
import { insertSchoolSchema, patchSchoolSchema } from "@workspace/db/schema";

const router = Router();

function firstZodError(err: { issues: { message: string }[] }): string {
  return err.issues[0]?.message ?? "Validation error";
}

/* GET /api/admin/schools — list all schools (any network-scope user) */
router.get("/", async (_req, res) => {
  try {
    const rows = await db.select().from(schools).orderBy(schools.displayName);
    res.json(rows);
  } catch (err) {
    console.error("GET /admin/schools error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* POST /api/admin/schools — create school (NETWORK_ADMIN only) */
router.post("/", requireNetworkAdmin, async (req, res) => {
  try {
    const parsed = insertSchoolSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstZodError(parsed.error) });
      return;
    }
    const [row] = await db.insert(schools).values(parsed.data).returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("POST /admin/schools error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* PATCH /api/admin/schools/:id — update school (NETWORK_ADMIN only) */
router.patch("/:id", requireNetworkAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const parsed = patchSchoolSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstZodError(parsed.error) });
      return;
    }
    const updates = parsed.data;
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "Nothing to update" });
      return;
    }
    const [row] = await db
      .update(schools)
      .set(updates)
      .where(eq(schools.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "School not found" }); return; }
    res.json(row);
  } catch (err) {
    console.error("PATCH /admin/schools/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* POST /api/admin/schools/bulk — upsert many schools via CSV upload (NETWORK_ADMIN only) */
router.post("/bulk", requireNetworkAdmin, async (req, res) => {
  const rows: unknown[] = req.body;

  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: "Expected a non-empty array of school rows" });
    return;
  }

  /* ── Phase 1: validate all rows before touching the DB ── */
  const validationErrors: { row: number; error: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const parsed = insertSchoolSchema.safeParse(rows[i]);
    if (!parsed.success) {
      validationErrors.push({ row: i + 2, error: firstZodError(parsed.error) });
    }
  }

  if (validationErrors.length > 0) {
    res.json({ added: 0, updated: 0, failed: validationErrors });
    return;
  }

  /* ── Phase 2: all rows valid — upsert ── */
  let added   = 0;
  let updated = 0;
  const dbErrors: { row: number; error: string }[] = [];

  const client = await pool.connect();
  try {
    for (let i = 0; i < rows.length; i++) {
      const r = insertSchoolSchema.parse(rows[i]);
      const rowNum = i + 2;
      try {
        const { rows: result } = await client.query<{ xmax: string }>(`
          INSERT INTO schools (display_name, full_name, abbreviation, region, grade_span)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (abbreviation) DO UPDATE
            SET display_name = EXCLUDED.display_name,
                full_name    = EXCLUDED.full_name,
                region       = EXCLUDED.region,
                grade_span   = EXCLUDED.grade_span
          RETURNING xmax
        `, [r.displayName, r.fullName, r.abbreviation, r.region, r.gradeSpan]);

        if (result[0].xmax === "0") {
          added++;
        } else {
          updated++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        dbErrors.push({ row: rowNum, error: msg });
      }
    }
  } finally {
    client.release();
  }

  res.json({ added, updated, failed: dbErrors });
});

/* DELETE /api/admin/schools/:id — delete school (NETWORK_ADMIN only) */
router.delete("/:id", requireNetworkAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const teacherCount = (await db.select().from(people).where(eq(people.schoolId, id))).length;
    if (teacherCount > 0) {
      res.status(409).json({ error: `Cannot delete: ${teacherCount} person/people are assigned to this school.` });
      return;
    }
    await db.delete(schools).where(eq(schools.id, id));
    res.status(204).end();
  } catch (err) {
    console.error("DELETE /admin/schools/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
