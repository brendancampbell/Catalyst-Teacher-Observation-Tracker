import { Router } from "express";
import { db } from "@workspace/db";
import { teachers } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

/* GET /api/admin/teachers — all teachers (including inactive) */
router.get("/", async (_req, res) => {
  try {
    const rows = await db.select().from(teachers).orderBy(teachers.name);
    res.json(rows);
  } catch (err) {
    console.error("GET /admin/teachers error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* POST /api/admin/teachers — create teacher */
router.post("/", async (req, res) => {
  try {
    const { name, subject, gradeLevel } = req.body as {
      name: string;
      subject: string;
      gradeLevel: string[];
    };
    if (!name?.trim() || !subject?.trim()) {
      res.status(400).json({ error: "name and subject are required" });
      return;
    }
    const [row] = await db
      .insert(teachers)
      .values({ name: name.trim(), subject: subject.trim(), gradeLevel: gradeLevel ?? [], isActive: true })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("POST /admin/teachers error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* PATCH /api/admin/teachers/:id — update name/subject/gradeLevel */
router.patch("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, subject, gradeLevel } = req.body as Partial<{
      name: string;
      subject: string;
      gradeLevel: string[];
    }>;
    const updates: Record<string, unknown> = {};
    if (name !== undefined)       updates.name       = name.trim();
    if (subject !== undefined)    updates.subject    = subject.trim();
    if (gradeLevel !== undefined) updates.gradeLevel = gradeLevel;
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "Nothing to update" });
      return;
    }
    const [row] = await db.update(teachers).set(updates).where(eq(teachers.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Teacher not found" }); return; }
    res.json(row);
  } catch (err) {
    console.error("PATCH /admin/teachers/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* PATCH /api/admin/teachers/:id/toggle-active — flip isActive */
router.patch("/:id/toggle-active", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await db.query.teachers.findFirst({ where: eq(teachers.id, id) });
    if (!existing) { res.status(404).json({ error: "Teacher not found" }); return; }
    const [row] = await db
      .update(teachers)
      .set({ isActive: !existing.isActive })
      .where(eq(teachers.id, id))
      .returning();
    res.json(row);
  } catch (err) {
    console.error("PATCH /admin/teachers/:id/toggle-active error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
