import { Router } from "express";
import { db, pool } from "@workspace/db";
import { schools, people } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireNetworkAdmin } from "../middleware/auth";
import { REGIONS, GRADE_SPANS } from "@workspace/db/schema";

const router = Router();

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
    const { displayName, fullName, abbreviation, region, gradeSpan } = req.body as {
      displayName: string;
      fullName: string;
      abbreviation: string;
      region: string;
      gradeSpan: string;
    };
    if (!displayName?.trim()) {
      res.status(400).json({ error: "Display Name is required" });
      return;
    }
    if (!fullName?.trim()) {
      res.status(400).json({ error: "Full Name is required" });
      return;
    }
    if (!abbreviation?.trim()) {
      res.status(400).json({ error: "Abbreviation is required" });
      return;
    }
    if (!region?.trim()) {
      res.status(400).json({ error: "Region is required" });
      return;
    }
    if (!gradeSpan?.trim()) {
      res.status(400).json({ error: "Grade Span is required" });
      return;
    }
    const [row] = await db
      .insert(schools)
      .values({
        displayName:  displayName.trim(),
        fullName:     fullName.trim(),
        abbreviation: abbreviation.trim(),
        region:       region.trim(),
        gradeSpan:    gradeSpan.trim(),
      })
      .returning();
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
    const { displayName, fullName, abbreviation, region, gradeSpan } = req.body as Partial<{
      displayName:  string;
      fullName:     string;
      abbreviation: string;
      region:       string;
      gradeSpan:    string;
    }>;
    const updates: Record<string, unknown> = {};
    if (displayName !== undefined) {
      if (!displayName.trim()) { res.status(400).json({ error: "Display Name cannot be empty" }); return; }
      updates.displayName = displayName.trim();
    }
    if (fullName !== undefined) {
      if (!fullName.trim()) { res.status(400).json({ error: "Full Name cannot be empty" }); return; }
      updates.fullName = fullName.trim();
    }
    if (abbreviation !== undefined) {
      if (!abbreviation.trim()) { res.status(400).json({ error: "Abbreviation cannot be empty" }); return; }
      updates.abbreviation = abbreviation.trim();
    }
    if (region !== undefined) {
      if (!region.trim()) { res.status(400).json({ error: "Region is required" }); return; }
      updates.region = region.trim();
    }
    if (gradeSpan !== undefined) {
      if (!gradeSpan.trim()) { res.status(400).json({ error: "Grade Span is required" }); return; }
      updates.gradeSpan = gradeSpan.trim();
    }
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
  type BulkRow = { displayName: string; fullName: string; abbreviation: string; region: string; gradeSpan: string };
  const rows: BulkRow[] = req.body;

  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: "Expected a non-empty array of school rows" });
    return;
  }

  const validRegions    = new Set<string>(REGIONS);
  const validGradeSpans = new Set<string>(GRADE_SPANS);

  /* ── Phase 1: validate all rows before touching the DB ── */
  const validationErrors: { row: number; error: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rowNum = i + 2;

    if (!r.displayName?.trim())         validationErrors.push({ row: rowNum, error: "Display Name is required" });
    else if (!r.fullName?.trim())       validationErrors.push({ row: rowNum, error: "Full Name is required" });
    else if (!r.abbreviation?.trim())   validationErrors.push({ row: rowNum, error: "Abbreviation is required" });
    else if (!r.region?.trim())         validationErrors.push({ row: rowNum, error: "Region is required" });
    else if (!r.gradeSpan?.trim())      validationErrors.push({ row: rowNum, error: "Grade Span is required" });
    else if (!validRegions.has(r.region.trim()))
      validationErrors.push({ row: rowNum, error: `Unknown region "${r.region}" — must be one of: ${REGIONS.join(", ")}` });
    else if (!validGradeSpans.has(r.gradeSpan.trim()))
      validationErrors.push({ row: rowNum, error: `Unknown grade span "${r.gradeSpan}" — must be one of: ${GRADE_SPANS.join(", ")}` });
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
      const r = rows[i];
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
        `, [r.displayName.trim(), r.fullName.trim(), r.abbreviation.trim(), r.region.trim(), r.gradeSpan.trim()]);

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
