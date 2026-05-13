import { Router } from "express";
import { db } from "@workspace/db";
import { teachers, schools } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { requireRole } from "../middleware/auth";

const router = Router();

/* ── Shared select shape ─────────────────────────────────────────── */
const TEACHER_SELECT = {
  id:             teachers.id,
  firstName:      teachers.firstName,
  lastName:       teachers.lastName,
  employeeId:     teachers.employeeId,
  email:          teachers.email,
  subject:        teachers.subject,
  gradeLevel:     teachers.gradeLevel,
  isActive:       teachers.isActive,
  schoolId:       teachers.schoolId,
  schoolName:     schools.name,
} as const;

function withName<T extends { firstName: string; lastName: string }>(row: T) {
  return { ...row, name: `${row.firstName} ${row.lastName}`.trim() };
}

/* GET /api/admin/teachers — teachers in scope, with school name */
router.get("/", requireRole("COACH", "SCHOOL_LEADER", "NETWORK_LEADER", "NETWORK_ADMIN"), async (req, res) => {
  try {
    const user = req.user as Express.User;
    const isNetworkScope = user.role === "NETWORK_LEADER" || user.role === "NETWORK_ADMIN";

    const rows = await db
      .select(TEACHER_SELECT)
      .from(teachers)
      .leftJoin(schools, eq(teachers.schoolId, schools.id))
      .where(isNetworkScope ? undefined : eq(teachers.schoolId, user.schoolId!))
      .orderBy(teachers.lastName, teachers.firstName);
    res.json(rows.map(withName));
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
    const { firstName, lastName, employeeId, email, subject, gradeLevel, schoolId } = req.body as {
      firstName:   string;
      lastName:    string;
      employeeId?: string | null;
      email:       string;
      subject:     string;
      gradeLevel:  string[];
      schoolId?:   number | null;
    };
    if (!firstName?.trim()) {
      res.status(400).json({ error: "firstName is required" });
      return;
    }
    if (!lastName?.trim()) {
      res.status(400).json({ error: "lastName is required" });
      return;
    }
    if (!subject?.trim()) {
      res.status(400).json({ error: "subject is required" });
      return;
    }
    const trimmedEmail = email?.trim() ?? "";
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      res.status(400).json({ error: "A valid email address is required" });
      return;
    }

    const assignedSchoolId = isNetworkAdmin ? (schoolId ?? null) : user.schoolId;

    const [row] = await db
      .insert(teachers)
      .values({
        firstName:  firstName.trim(),
        lastName:   lastName.trim(),
        employeeId: employeeId?.trim() || null,
        email:      trimmedEmail,
        subject:    subject.trim(),
        gradeLevel: gradeLevel ?? [],
        isActive:   true,
        schoolId:   assignedSchoolId,
      })
      .returning();

    const [withSchool] = await db
      .select(TEACHER_SELECT)
      .from(teachers)
      .leftJoin(schools, eq(teachers.schoolId, schools.id))
      .where(eq(teachers.id, row.id));

    res.status(201).json(withName(withSchool!));
  } catch (err) {
    console.error("POST /admin/teachers error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* PATCH /api/admin/teachers/:id — update teacher fields */
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

    const { firstName, lastName, employeeId, email, subject, gradeLevel, schoolId } = req.body as Partial<{
      firstName:  string;
      lastName:   string;
      employeeId: string | null;
      email:      string | null;
      subject:    string;
      gradeLevel: string[];
      schoolId:   number | null;
    }>;
    const trimmedEmail = email?.trim() ?? "";
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      res.status(400).json({ error: "A valid email address is required" });
      return;
    }
    const updates: Record<string, unknown> = { email: trimmedEmail };
    if (firstName !== undefined) updates.firstName  = firstName.trim();
    if (lastName  !== undefined) updates.lastName   = lastName.trim();
    if (employeeId !== undefined) updates.employeeId = employeeId?.trim() || null;
    if (subject   !== undefined) updates.subject    = subject.trim();
    if (gradeLevel !== undefined) updates.gradeLevel = gradeLevel;
    if (schoolId  !== undefined && isNetworkAdmin) updates.schoolId = schoolId;
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "Nothing to update" });
      return;
    }
    await db.update(teachers).set(updates).where(eq(teachers.id, id));

    const [withSchool] = await db
      .select(TEACHER_SELECT)
      .from(teachers)
      .leftJoin(schools, eq(teachers.schoolId, schools.id))
      .where(eq(teachers.id, id));

    if (!withSchool) { res.status(404).json({ error: "Teacher not found" }); return; }
    res.json(withName(withSchool));
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
      firstName?:  unknown;
      lastName?:   unknown;
      name?:       unknown;
      employeeId?: unknown;
      subject?:    unknown;
      gradeLevel?: unknown;
      school?:     unknown;
      email?:      unknown;
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

      /* Support both firstName/lastName columns and a legacy name column */
      let firstName: string | null = null;
      let lastName:  string | null = null;
      if (typeof raw.firstName === "string" && raw.firstName.trim()) {
        firstName = raw.firstName.trim();
        lastName  = typeof raw.lastName === "string" ? raw.lastName.trim() : "";
      } else if (typeof raw.name === "string" && raw.name.trim()) {
        const parts = raw.name.trim().split(/\s+/);
        firstName = parts[0] ?? "";
        lastName  = parts.slice(1).join(" ");
      }

      const employeeId = typeof raw.employeeId === "string" && raw.employeeId.trim()
        ? raw.employeeId.trim()
        : null;
      const subject = typeof raw.subject === "string" ? raw.subject.trim() : null;
      const school  = typeof raw.school  === "string" ? raw.school.trim()  : null;
      const email   = typeof raw.email   === "string" && raw.email.trim() ? raw.email.trim() : null;

      let gradeLevel: string[] = [];
      if (Array.isArray(raw.gradeLevel)) {
        gradeLevel = (raw.gradeLevel as unknown[]).map((g) => String(g).trim()).filter(Boolean);
      } else if (typeof raw.gradeLevel === "string" && raw.gradeLevel.trim()) {
        gradeLevel = raw.gradeLevel.split(",").map((g) => g.trim()).filter(Boolean);
      }

      const displayName = firstName ? `${firstName} ${lastName}`.trim() : null;

      if (!firstName) {
        results.push({ row: rowNum, status: "error", reason: "Missing firstName (or name)" });
        continue;
      }
      if (!subject) {
        results.push({ row: rowNum, status: "error", name: displayName!, reason: "Missing subject" });
        continue;
      }
      if (gradeLevel.length === 0) {
        results.push({ row: rowNum, status: "error", name: displayName!, reason: "Missing gradeLevel" });
        continue;
      }
      if (!email) {
        results.push({ row: rowNum, status: "error", name: displayName!, reason: "Missing email" });
        continue;
      }
      if (!email.includes("@")) {
        results.push({ row: rowNum, status: "error", name: displayName!, reason: "Invalid email address" });
        continue;
      }

      let schoolId: number | null = null;
      if (isNetworkAdmin) {
        if (!school) {
          results.push({ row: rowNum, status: "error", name: displayName!, reason: "Missing school (required for Network Admin imports)" });
          continue;
        }
        const found = schoolNameMap.get(school.toLowerCase());
        if (found === undefined) {
          results.push({ row: rowNum, status: "error", name: displayName!, reason: `School "${school}" not found` });
          continue;
        }
        schoolId = found;
      } else {
        schoolId = user.schoolId ?? null;
      }

      /* Duplicate check: employeeId takes priority, else firstName+lastName+school */
      const existing = employeeId
        ? await db.query.teachers.findFirst({ where: eq(teachers.employeeId, employeeId) })
        : await db.query.teachers.findFirst({
            where: and(
              eq(teachers.firstName, firstName),
              eq(teachers.lastName, lastName ?? ""),
              schoolId !== null ? eq(teachers.schoolId, schoolId) : undefined,
            ),
          });
      if (existing) {
        results.push({ row: rowNum, status: "skipped", name: displayName!, reason: "Duplicate teacher at this school" });
        continue;
      }

      try {
        await db.insert(teachers).values({
          firstName:  firstName,
          lastName:   lastName ?? "",
          employeeId: employeeId,
          email,
          subject,
          gradeLevel,
          isActive: true,
          schoolId,
        });
        results.push({ row: rowNum, status: "created", name: displayName! });
      } catch {
        results.push({ row: rowNum, status: "error", name: displayName!, reason: "Database error" });
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
    res.json({ ...row, name: `${row.firstName} ${row.lastName}`.trim() });
  } catch (err) {
    console.error("PATCH /admin/teachers/:id/toggle-active error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
