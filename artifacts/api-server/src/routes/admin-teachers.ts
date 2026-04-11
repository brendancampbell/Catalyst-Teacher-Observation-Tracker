import { Router } from "express";
import { db } from "@workspace/db";
import { teachers, schools } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { requireRole } from "../middleware/auth";

const router = Router();

/* GET /api/admin/teachers — teachers in scope, with school name */
router.get("/", requireRole("COACH", "SCHOOL_LEADER", "NETWORK_LEADER", "NETWORK_ADMIN"), async (req, res) => {
  try {
    const user = req.user as Express.User;
    const isNetworkScope = user.role === "NETWORK_LEADER" || user.role === "NETWORK_ADMIN";

    const rows = await db
      .select({
        id:         teachers.id,
        name:       teachers.name,
        subject:    teachers.subject,
        gradeLevel: teachers.gradeLevel,
        isActive:   teachers.isActive,
        schoolId:   teachers.schoolId,
        schoolName: schools.name,
      })
      .from(teachers)
      .leftJoin(schools, eq(teachers.schoolId, schools.id))
      .where(isNetworkScope ? undefined : eq(teachers.schoolId, user.schoolId!))
      .orderBy(teachers.name);
    res.json(rows);
  } catch (err) {
    console.error("GET /admin/teachers error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* POST /api/admin/teachers — create teacher (SCHOOL_LEADER: own school only) */
router.post("/", requireRole("SCHOOL_LEADER", "NETWORK_ADMIN"), async (req, res) => {
  try {
    const user = req.user as Express.User;
    const isNetworkAdmin = user.role === "NETWORK_ADMIN";
    const { name, subject, gradeLevel, schoolId } = req.body as {
      name: string;
      subject: string;
      gradeLevel: string[];
      schoolId?: number | null;
    };
    if (!name?.trim() || !subject?.trim()) {
      res.status(400).json({ error: "name and subject are required" });
      return;
    }

    const assignedSchoolId = isNetworkAdmin ? (schoolId ?? null) : user.schoolId;

    const [row] = await db
      .insert(teachers)
      .values({
        name: name.trim(),
        subject: subject.trim(),
        gradeLevel: gradeLevel ?? [],
        isActive: true,
        schoolId: assignedSchoolId,
      })
      .returning();

    const withSchool = await db
      .select({
        id: teachers.id, name: teachers.name, subject: teachers.subject,
        gradeLevel: teachers.gradeLevel, isActive: teachers.isActive,
        schoolId: teachers.schoolId, schoolName: schools.name,
      })
      .from(teachers)
      .leftJoin(schools, eq(teachers.schoolId, schools.id))
      .where(eq(teachers.id, row.id));

    res.status(201).json(withSchool[0] ?? row);
  } catch (err) {
    console.error("POST /admin/teachers error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* PATCH /api/admin/teachers/:id — update name/subject/gradeLevel/schoolId */
router.patch("/:id", requireRole("SCHOOL_LEADER", "NETWORK_ADMIN"), async (req, res) => {
  try {
    const user = req.user as Express.User;
    const isNetworkAdmin = user.role === "NETWORK_ADMIN";
    const id = Number(req.params.id);

    const existing = await db.query.teachers.findFirst({ where: eq(teachers.id, id) });
    if (!existing) { res.status(404).json({ error: "Teacher not found" }); return; }

    if (!isNetworkAdmin && existing.schoolId !== user.schoolId) {
      res.status(403).json({ error: "Cannot edit teachers from another school" });
      return;
    }

    const { name, subject, gradeLevel, schoolId } = req.body as Partial<{
      name: string;
      subject: string;
      gradeLevel: string[];
      schoolId: number | null;
    }>;
    const updates: Record<string, unknown> = {};
    if (name !== undefined)       updates.name       = name.trim();
    if (subject !== undefined)    updates.subject    = subject.trim();
    if (gradeLevel !== undefined) updates.gradeLevel = gradeLevel;
    if (schoolId !== undefined && isNetworkAdmin) updates.schoolId = schoolId;
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "Nothing to update" });
      return;
    }
    await db.update(teachers).set(updates).where(eq(teachers.id, id));

    const withSchool = await db
      .select({
        id: teachers.id, name: teachers.name, subject: teachers.subject,
        gradeLevel: teachers.gradeLevel, isActive: teachers.isActive,
        schoolId: teachers.schoolId, schoolName: schools.name,
      })
      .from(teachers)
      .leftJoin(schools, eq(teachers.schoolId, schools.id))
      .where(eq(teachers.id, id));

    if (!withSchool[0]) { res.status(404).json({ error: "Teacher not found" }); return; }
    res.json(withSchool[0]);
  } catch (err) {
    console.error("PATCH /admin/teachers/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* POST /api/admin/teachers/bulk — bulk create teachers from array */
router.post("/bulk", requireRole("SCHOOL_LEADER", "NETWORK_ADMIN"), async (req, res) => {
  try {
    const user = req.user as Express.User;
    const isNetworkAdmin = user.role === "NETWORK_ADMIN";

    const rows = req.body as Array<{
      name?: unknown;
      subject?: unknown;
      gradeLevel?: unknown;
      school?: unknown;
    }>;

    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "Body must be a non-empty array of teacher objects" });
      return;
    }

    const allSchools = await db.select({ id: schools.id, name: schools.name }).from(schools);
    const schoolNameMap = new Map<string, number>(
      allSchools.map((s) => [s.name.toLowerCase().trim(), s.id]),
    );

    type RowResult = {
      row: number;
      status: "created" | "skipped" | "error";
      name?: string;
      reason?: string;
    };

    const results: RowResult[] = [];

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];
      const rowNum = i + 1;

      const name    = typeof raw.name    === "string" ? raw.name.trim()    : null;
      const subject = typeof raw.subject === "string" ? raw.subject.trim() : null;
      const school  = typeof raw.school  === "string" ? raw.school.trim()  : null;

      // Parse gradeLevel — accept string (comma-separated) or array
      let gradeLevel: string[] = [];
      if (Array.isArray(raw.gradeLevel)) {
        gradeLevel = (raw.gradeLevel as unknown[]).map((g) => String(g).trim()).filter(Boolean);
      } else if (typeof raw.gradeLevel === "string" && raw.gradeLevel.trim()) {
        gradeLevel = raw.gradeLevel.split(",").map((g) => g.trim()).filter(Boolean);
      }

      if (!name) {
        results.push({ row: rowNum, status: "error", reason: "Missing name" });
        continue;
      }
      if (!subject) {
        results.push({ row: rowNum, status: "error", name, reason: "Missing subject" });
        continue;
      }
      if (gradeLevel.length === 0) {
        results.push({ row: rowNum, status: "error", name, reason: "Missing gradeLevel" });
        continue;
      }

      // Resolve school to schoolId
      let schoolId: number | null = null;
      if (isNetworkAdmin) {
        if (!school) {
          results.push({ row: rowNum, status: "error", name, reason: "Missing school (required for Network Admin imports)" });
          continue;
        }
        const found = schoolNameMap.get(school.toLowerCase());
        if (found === undefined) {
          results.push({ row: rowNum, status: "error", name, reason: `School "${school}" not found` });
          continue;
        }
        schoolId = found;
      } else {
        // SCHOOL_LEADER: always assign to their own school, school column in CSV is ignored
        schoolId = user.schoolId ?? null;
      }

      // Check for duplicate: same name + schoolId
      const existing = await db.query.teachers.findFirst({
        where: and(eq(teachers.name, name), schoolId !== null ? eq(teachers.schoolId, schoolId) : undefined),
      });
      if (existing) {
        results.push({ row: rowNum, status: "skipped", name, reason: "Duplicate teacher name at this school" });
        continue;
      }

      try {
        await db.insert(teachers).values({
          name,
          subject,
          gradeLevel,
          isActive: true,
          schoolId,
        });
        results.push({ row: rowNum, status: "created", name });
      } catch {
        results.push({ row: rowNum, status: "error", name, reason: "Database error" });
      }
    }

    res.json({ results });
  } catch (err) {
    console.error("POST /admin/teachers/bulk error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* PATCH /api/admin/teachers/:id/toggle-active — flip isActive */
router.patch("/:id/toggle-active", requireRole("SCHOOL_LEADER", "NETWORK_ADMIN"), async (req, res) => {
  try {
    const user = req.user as Express.User;
    const isNetworkAdmin = user.role === "NETWORK_ADMIN";
    const id = Number(req.params.id);
    const existing = await db.query.teachers.findFirst({ where: eq(teachers.id, id) });
    if (!existing) { res.status(404).json({ error: "Teacher not found" }); return; }

    if (!isNetworkAdmin && existing.schoolId !== user.schoolId) {
      res.status(403).json({ error: "Cannot edit teachers from another school" });
      return;
    }

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
