import { Router } from "express";
import { db } from "@workspace/db";
import { schools, teachers } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

/* GET /api/admin/schools — list all schools */
router.get("/", async (_req, res) => {
  try {
    const rows = await db.select().from(schools).orderBy(schools.name);
    res.json(rows);
  } catch (err) {
    console.error("GET /admin/schools error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* POST /api/admin/schools — create school */
router.post("/", async (req, res) => {
  try {
    const { name, region, gradeSpan } = req.body as { name: string; region?: string; gradeSpan?: string };
    if (!name?.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const [row] = await db
      .insert(schools)
      .values({ name: name.trim(), region: region ?? null, gradeSpan: gradeSpan ?? null })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("POST /admin/schools error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* PATCH /api/admin/schools/:id — update school */
router.patch("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, region, gradeSpan } = req.body as Partial<{ name: string; region: string | null; gradeSpan: string | null }>;
    const updates: Record<string, unknown> = {};
    if (name !== undefined)      updates.name      = name.trim();
    if (region !== undefined)    updates.region    = region;
    if (gradeSpan !== undefined) updates.gradeSpan = gradeSpan;
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

/* DELETE /api/admin/schools/:id — delete school */
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const teacherCount = (await db.select().from(teachers).where(eq(teachers.schoolId, id))).length;
    if (teacherCount > 0) {
      res.status(409).json({ error: `Cannot delete: ${teacherCount} teacher(s) are assigned to this school.` });
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
