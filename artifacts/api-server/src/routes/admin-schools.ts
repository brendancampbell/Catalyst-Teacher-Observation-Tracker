import { Router } from "express";
import { db } from "@workspace/db";
import { schools, people } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireNetworkAdmin } from "../middleware/auth";

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
