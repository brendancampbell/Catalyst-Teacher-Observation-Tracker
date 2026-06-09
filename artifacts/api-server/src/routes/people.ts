import { Router } from "express";
import { db } from "@workspace/db";
import { people, schools } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { requireRole, type UserRole } from "../middleware/auth";
import { DEPARTMENT_VALUES } from "@workspace/db/schema";

const router = Router();

const SCHOOL_ASSIGNABLE_ROLES: UserRole[] = ["COACH", "SCHOOL_LEADER"];
const ALL_ROLES: UserRole[] = ["COACH", "SCHOOL_LEADER", "NETWORK_LEADER", "NETWORK_ADMIN", "NO_ACCESS"];

const PEOPLE_SELECT = {
  employeeId:               people.employeeId,
  firstName:                people.firstName,
  lastName:                 people.lastName,
  email:                    people.email,
  role:                     people.role,
  schoolId:                 people.schoolId,
  schoolName:               schools.name,
  isActive:                 people.isActive,
  includeInFeedbackTracker: people.includeInFeedbackTracker,
  primaryInstructionalLeaderId: people.primaryInstructionalLeaderId,
  department:               people.department,
  gradeLevel:               people.gradeLevel,
  needsRescore:             people.needsRescore,
  rescoreDueDate:           people.rescoreDueDate,
} as const;

function withName<T extends { firstName: string; lastName: string; gradeLevel: string[] | null }>(row: T) {
  return { ...row, name: `${row.firstName} ${row.lastName}`.trim(), gradeLevel: row.gradeLevel ?? [] };
}

/* ── GET /api/people ──────────────────────────────────────────────
   Query params:
   - includeInFeedbackTracker=true   → filter to observable people
   - schoolId=<n>                    → filter to school (NA only)
   SCHOOL_LEADER / COACH: own school only
   NETWORK_ADMIN: all                                               */
router.get("/", requireRole("COACH", "SCHOOL_LEADER", "NETWORK_LEADER", "NETWORK_ADMIN"), async (req, res) => {
  try {
    const currentUser = req.user as Express.User;
    const isNetworkScope = currentUser.role === "NETWORK_LEADER" || currentUser.role === "NETWORK_ADMIN";
    const feedbackOnly    = req.query.includeInFeedbackTracker === "true";
    const includeInactive = req.query.includeInactive === "true";
    const schoolIdParam   = req.query.schoolId ? Number(req.query.schoolId) : null;

    const effectiveSchoolId = isNetworkScope
      ? (schoolIdParam ?? null)
      : currentUser.schoolId ?? null;

    let whereClause = undefined as ReturnType<typeof and> | undefined;

    const conditions = [];
    if (!includeInactive) {
      conditions.push(eq(people.isActive, true));
    }
    if (effectiveSchoolId !== null) {
      conditions.push(eq(people.schoolId, effectiveSchoolId));
    }
    if (feedbackOnly) {
      conditions.push(eq(people.includeInFeedbackTracker, true));
    }

    if (conditions.length === 1) {
      whereClause = conditions[0] as ReturnType<typeof and>;
    } else if (conditions.length > 1) {
      whereClause = and(...conditions as [ReturnType<typeof eq>, ...ReturnType<typeof eq>[]]);
    }

    const rows = await db
      .select(PEOPLE_SELECT)
      .from(people)
      .leftJoin(schools, eq(people.schoolId, schools.id))
      .where(whereClause)
      .orderBy(people.lastName, people.firstName);

    res.json(rows.map(withName));
  } catch (err) {
    console.error("GET /people error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── POST /api/people ─────────────────────────────────────────────
   Create a new person.
   SCHOOL_LEADER: Coach or School Leader in own school only.
   NETWORK_ADMIN: any role, any school.                             */
router.post("/", requireRole("SCHOOL_LEADER", "NETWORK_ADMIN"), async (req, res) => {
  try {
    const currentUser = req.user as Express.User;
    const isNetworkAdmin = currentUser.role === "NETWORK_ADMIN";

    const {
      employeeId, firstName, lastName, email, role, schoolId,
      includeInFeedbackTracker, department, gradeLevel,
      primaryInstructionalLeaderId,
    } = req.body as {
      employeeId?: string;
      firstName: string;
      lastName: string;
      email: string;
      role: UserRole;
      schoolId?: number | null;
      includeInFeedbackTracker?: boolean;
      department?: string | null;
      gradeLevel?: string[] | null;
      primaryInstructionalLeaderId?: string | null;
    };

    if (!firstName?.trim()) { res.status(400).json({ error: "firstName is required" }); return; }
    if (!lastName?.trim())  { res.status(400).json({ error: "lastName is required" });  return; }
    const trimmedEmail = email?.trim().toLowerCase() ?? "";
    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      res.status(400).json({ error: "A valid email address is required" }); return;
    }
    if (!role || !ALL_ROLES.includes(role as UserRole)) {
      res.status(400).json({ error: `Invalid role: ${role}` }); return;
    }

    if (!isNetworkAdmin) {
      if (!SCHOOL_ASSIGNABLE_ROLES.includes(role as UserRole)) {
        res.status(403).json({ error: "School Leaders can only create Coach or School Leader people" }); return;
      }
      if ((schoolId ?? currentUser.schoolId) !== currentUser.schoolId) {
        res.status(403).json({ error: "School Leaders can only create people in their own school" }); return;
      }
    }

    if (department && !DEPARTMENT_VALUES.includes(department as typeof DEPARTMENT_VALUES[number])) {
      res.status(400).json({ error: `Invalid department: ${department}` }); return;
    }

    const assignedSchoolId = isNetworkAdmin ? (schoolId ?? null) : currentUser.schoolId;

    const generatedEmpId = employeeId?.trim()
      || `EMP-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

    const [created] = await db.insert(people).values({
      employeeId: generatedEmpId,
      firstName:  firstName.trim(),
      lastName:   lastName.trim(),
      email:      trimmedEmail,
      role:       role as UserRole,
      schoolId:   assignedSchoolId,
      includeInFeedbackTracker: includeInFeedbackTracker ?? false,
      department:  department as typeof DEPARTMENT_VALUES[number] ?? null,
      gradeLevel:  gradeLevel ?? null,
      primaryInstructionalLeaderId: primaryInstructionalLeaderId ?? null,
    }).returning();

    const [withSchool] = await db
      .select(PEOPLE_SELECT)
      .from(people)
      .leftJoin(schools, eq(people.schoolId, schools.id))
      .where(eq(people.employeeId, created.employeeId));

    res.status(201).json(withName(withSchool!));
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && (err as { code?: unknown }).code === "23505") {
      res.status(409).json({ error: "A person with that email or employee ID already exists" });
      return;
    }
    console.error("POST /people error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── POST /api/people/bulk ────────────────────────────────────────
   Bulk create people from a JSON array.
   SCHOOL_LEADER: can import people for own school (role limited).
   NETWORK_ADMIN: any school.                                       */
router.post("/bulk", requireRole("SCHOOL_LEADER", "NETWORK_ADMIN"), async (req, res) => {
  try {
    const currentUser = req.user as Express.User;
    const isNetworkAdmin = currentUser.role === "NETWORK_ADMIN";

    const rows = req.body as Array<{
      firstName?:               unknown;
      lastName?:                unknown;
      name?:                    unknown;
      employeeId?:              unknown;
      email?:                   unknown;
      role?:                    unknown;
      school?:                  unknown;
      includeInFeedbackTracker?: unknown;
      department?:              unknown;
      gradeLevel?:              unknown;
      primaryInstructionalLeaderId?: unknown;
    }>;

    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "Body must be a non-empty array of person objects" });
      return;
    }

    const allSchools = await db.select({ id: schools.id, name: schools.name }).from(schools);
    const schoolNameMap = new Map<string, number>(
      allSchools.map((s) => [s.name.toLowerCase().trim(), s.id]),
    );
    const schoolIdSet = new Set<number>(allSchools.map((s) => s.id));

    type RowResult = {
      row: number;
      status: "created" | "skipped" | "error";
      name?: string;
      email?: string;
      reason?: string;
    };

    const results: RowResult[] = [];

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];
      const rowNum = i + 1;

      let firstName: string | null = null;
      let lastName: string | null = null;

      if (typeof raw.firstName === "string" && raw.firstName.trim()) {
        firstName = raw.firstName.trim();
        lastName = typeof raw.lastName === "string" ? raw.lastName.trim() : "";
      } else if (typeof raw.name === "string" && raw.name.trim()) {
        const parts = raw.name.trim().split(/\s+/);
        firstName = parts[0] ?? "";
        lastName = parts.slice(1).join(" ");
      }

      const email = typeof raw.email === "string" && raw.email.trim()
        ? raw.email.trim().toLowerCase()
        : null;
      const employeeIdRaw = typeof raw.employeeId === "string" && raw.employeeId.trim()
        ? raw.employeeId.trim()
        : null;
      const roleRaw = typeof raw.role === "string" ? raw.role.trim().toUpperCase() : null;
      const school = typeof raw.school === "string" ? raw.school.trim() : null;
      const includeInFB = typeof raw.includeInFeedbackTracker === "string"
        ? raw.includeInFeedbackTracker.toLowerCase() === "true"
        : typeof raw.includeInFeedbackTracker === "boolean"
          ? raw.includeInFeedbackTracker
          : false;
      const deptRaw = typeof raw.department === "string" ? raw.department.trim() : null;
      const pilIdRaw = typeof raw.primaryInstructionalLeaderId === "string" && raw.primaryInstructionalLeaderId.trim()
        ? raw.primaryInstructionalLeaderId.trim()
        : null;

      let gradeLevel: string[] = [];
      if (Array.isArray(raw.gradeLevel)) {
        gradeLevel = (raw.gradeLevel as unknown[]).map((g) => String(g).trim()).filter(Boolean);
      } else if (typeof raw.gradeLevel === "string" && raw.gradeLevel.trim()) {
        gradeLevel = raw.gradeLevel.split(",").map((g) => g.trim()).filter(Boolean);
      }

      const displayName = firstName ? `${firstName} ${lastName ?? ""}`.trim() : null;

      if (!firstName) {
        results.push({ row: rowNum, status: "error", reason: "Missing firstName (or name)" });
        continue;
      }
      if (!email) {
        results.push({ row: rowNum, status: "error", name: displayName!, reason: "Missing email" });
        continue;
      }
      if (!email.includes("@")) {
        results.push({ row: rowNum, status: "error", name: displayName!, email, reason: "Invalid email address" });
        continue;
      }

      const role = (roleRaw ?? "NO_ACCESS") as UserRole;
      if (!ALL_ROLES.includes(role)) {
        results.push({ row: rowNum, status: "error", name: displayName!, email, reason: `Invalid role "${raw.role}"` });
        continue;
      }

      if (deptRaw && !DEPARTMENT_VALUES.includes(deptRaw as typeof DEPARTMENT_VALUES[number])) {
        results.push({ row: rowNum, status: "error", name: displayName!, email, reason: `Invalid department "${deptRaw}"` });
        continue;
      }

      let schoolId: number | null = null;
      if (isNetworkAdmin) {
        if (school) {
          const byName = schoolNameMap.get(school.toLowerCase());
          if (byName !== undefined) {
            schoolId = byName;
          } else {
            const asNum = Number(school);
            if (!isNaN(asNum) && schoolIdSet.has(asNum)) {
              schoolId = asNum;
            } else {
              results.push({ row: rowNum, status: "error", name: displayName!, email, reason: `School "${school}" not found` });
              continue;
            }
          }
        }
      } else {
        schoolId = currentUser.schoolId ?? null;
      }

      if (!isNetworkAdmin && !SCHOOL_ASSIGNABLE_ROLES.includes(role as UserRole) && role !== "NO_ACCESS") {
        results.push({ row: rowNum, status: "error", name: displayName!, email, reason: "School Leaders cannot import Network-level roles" });
        continue;
      }

      const empId = employeeIdRaw
        || `EMP-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

      try {
        await db.insert(people).values({
          employeeId: empId,
          firstName:  firstName,
          lastName:   lastName ?? "",
          email,
          role,
          schoolId,
          includeInFeedbackTracker: includeInFB,
          department: deptRaw as typeof DEPARTMENT_VALUES[number] ?? null,
          gradeLevel: gradeLevel.length > 0 ? gradeLevel : null,
          primaryInstructionalLeaderId: pilIdRaw,
        });
        results.push({ row: rowNum, status: "created", name: displayName!, email });
      } catch (err: unknown) {
        const isDuplicate = (e: unknown): boolean => {
          if (typeof e !== "object" || e === null) return false;
          const obj = e as Record<string, unknown>;
          if (obj["code"] === "23505") return true;
          if (obj["cause"] && isDuplicate(obj["cause"])) return true;
          return false;
        };
        if (isDuplicate(err)) {
          results.push({ row: rowNum, status: "skipped", name: displayName!, email, reason: "Duplicate email or employee ID" });
        } else {
          results.push({ row: rowNum, status: "error", name: displayName!, email, reason: "Database error" });
        }
      }
    }

    res.json({ results });
  } catch (err) {
    console.error("POST /people/bulk error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── PATCH /api/people/:employeeId ───────────────────────────────
   Update a person's fields.
   SCHOOL_LEADER: own school, school-scoped roles only.
   NETWORK_ADMIN: any person, any role.                             */
router.patch("/:employeeId", requireRole("SCHOOL_LEADER", "NETWORK_ADMIN"), async (req, res) => {
  try {
    const currentUser = req.user as Express.User;
    const isNetworkAdmin = currentUser.role === "NETWORK_ADMIN";
    const empId = String(req.params.employeeId);

    const target = await db.query.people.findFirst({ where: eq(people.employeeId, empId) });
    if (!target) { res.status(404).json({ error: "Person not found" }); return; }

    if (!isNetworkAdmin) {
      if (target.schoolId !== currentUser.schoolId) {
        res.status(403).json({ error: "Cannot edit people from another school" }); return;
      }
      if (
        !SCHOOL_ASSIGNABLE_ROLES.includes(target.role as UserRole) &&
        target.role !== "NO_ACCESS"
      ) {
        res.status(403).json({ error: "Cannot edit Network-level people" }); return;
      }
    }

    const {
      firstName, lastName, email, role, schoolId,
      includeInFeedbackTracker, department, gradeLevel,
      primaryInstructionalLeaderId, isActive,
    } = req.body as Partial<{
      firstName:               string;
      lastName:                string;
      email:                   string;
      role:                    UserRole;
      schoolId:                number | null;
      includeInFeedbackTracker: boolean;
      department:              string | null;
      gradeLevel:              string[] | null;
      primaryInstructionalLeaderId: string | null;
      isActive:                boolean;
    }>;

    const trimmedEmail = email?.trim().toLowerCase();
    if (trimmedEmail !== undefined && (!trimmedEmail || !trimmedEmail.includes("@"))) {
      res.status(400).json({ error: "A valid email address is required" }); return;
    }
    if (role && !ALL_ROLES.includes(role)) {
      res.status(400).json({ error: `Invalid role: ${role}` }); return;
    }
    if (department && !DEPARTMENT_VALUES.includes(department as typeof DEPARTMENT_VALUES[number])) {
      res.status(400).json({ error: `Invalid department: ${department}` }); return;
    }
    if (!isNetworkAdmin && role && !SCHOOL_ASSIGNABLE_ROLES.includes(role) && role !== "NO_ACCESS") {
      res.status(403).json({ error: "School Leaders can only assign Coach or School Leader roles" }); return;
    }

    const updates: Record<string, unknown> = {};
    if (firstName !== undefined) updates.firstName = firstName.trim();
    if (lastName  !== undefined) updates.lastName  = lastName.trim();
    if (trimmedEmail !== undefined) updates.email  = trimmedEmail;
    if (role      !== undefined) updates.role      = role;
    if (isNetworkAdmin && schoolId !== undefined) updates.schoolId = schoolId;
    if (includeInFeedbackTracker !== undefined) updates.includeInFeedbackTracker = includeInFeedbackTracker;
    if (department !== undefined) updates.department = department;
    if (gradeLevel !== undefined) updates.gradeLevel = gradeLevel;
    if (primaryInstructionalLeaderId !== undefined) updates.primaryInstructionalLeaderId = primaryInstructionalLeaderId;
    if (isActive   !== undefined) updates.isActive   = isActive;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "Nothing to update" }); return;
    }

    await db.update(people).set(updates as Partial<typeof people.$inferInsert>).where(eq(people.employeeId, empId));

    const [withSchool] = await db
      .select(PEOPLE_SELECT)
      .from(people)
      .leftJoin(schools, eq(people.schoolId, schools.id))
      .where(eq(people.employeeId, empId));

    if (!withSchool) { res.status(404).json({ error: "Person not found" }); return; }
    res.json(withName(withSchool));
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && (err as { code?: unknown }).code === "23505") {
      res.status(409).json({ error: "A person with that email already exists" });
      return;
    }
    console.error("PATCH /people/:employeeId error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── PATCH /api/people/:employeeId/toggle-active ─────────────────
   Soft-delete: flip isActive. Cannot deactivate yourself.          */
router.patch("/:employeeId/toggle-active", requireRole("SCHOOL_LEADER", "NETWORK_ADMIN"), async (req, res) => {
  try {
    const currentUser = req.user as Express.User;
    const isNetworkAdmin = currentUser.role === "NETWORK_ADMIN";
    const empId = String(req.params.employeeId);

    if (empId === currentUser.employeeId) {
      res.status(400).json({ error: "You cannot deactivate your own account" }); return;
    }

    const target = await db.query.people.findFirst({ where: eq(people.employeeId, empId) });
    if (!target) { res.status(404).json({ error: "Person not found" }); return; }

    if (!isNetworkAdmin) {
      if (target.schoolId !== currentUser.schoolId) {
        res.status(403).json({ error: "Cannot edit people from another school" }); return;
      }
      if (!SCHOOL_ASSIGNABLE_ROLES.includes(target.role as UserRole) && target.role !== "NO_ACCESS") {
        res.status(403).json({ error: "Cannot edit Network-level people" }); return;
      }
    }

    const [updated] = await db
      .update(people)
      .set({ isActive: !target.isActive })
      .where(eq(people.employeeId, empId))
      .returning();

    const [withSchool] = await db
      .select(PEOPLE_SELECT)
      .from(people)
      .leftJoin(schools, eq(people.schoolId, schools.id))
      .where(eq(people.employeeId, updated.employeeId));

    res.json(withName(withSchool!));
  } catch (err) {
    console.error("PATCH /people/:employeeId/toggle-active error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
