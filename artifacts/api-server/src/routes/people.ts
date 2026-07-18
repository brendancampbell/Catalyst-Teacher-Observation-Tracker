import { Router } from "express";
import { db } from "@workspace/db";
import { people, schools, assignments } from "@workspace/db/schema";
import { eq, and, or, isNull } from "drizzle-orm";
import { requireRole, type UserRole } from "../middleware/auth";
import { DEPARTMENT_VALUES } from "@workspace/db/schema";

const router = Router();

const SCHOOL_ASSIGNABLE_ROLES: UserRole[] = ["COACH", "SCHOOL_LEADER"];
const NETWORK_ROLES: UserRole[] = ["NETWORK_LEADER", "NETWORK_ADMIN"];
const ALL_ROLES: UserRole[] = ["COACH", "SCHOOL_LEADER", "NETWORK_LEADER", "NETWORK_ADMIN", "NO_ACCESS"];

const PEOPLE_SELECT = {
  employeeId:               people.employeeId,
  firstName:                people.firstName,
  lastName:                 people.lastName,
  email:                    people.email,
  role:                     people.role,
  schoolId:                 people.schoolId,
  schoolName:               schools.displayName,
  isActive:                 people.isActive,
  includeInFeedbackTracker: people.includeInFeedbackTracker,
  department:               people.department,
  gradeLevel:               people.gradeLevel,
  needsRescore:             people.needsRescore,
  rescoreDueDate:           people.rescoreDueDate,
} as const;

function withName<T extends { firstName: string; lastName: string; gradeLevel: string[] | null }>(row: T) {
  return { ...row, name: `${row.firstName} ${row.lastName}`.trim(), gradeLevel: row.gradeLevel ?? [] };
}

/** Look up a school and return its isHomeOffice flag, or null if not found. */
async function getSchoolHomeOfficeFlag(schoolId: number): Promise<boolean | null> {
  const [row] = await db.select({ isHomeOffice: schools.isHomeOffice }).from(schools).where(eq(schools.id, schoolId));
  return row ? row.isHomeOffice : null;
}

/**
 * Validate that the role/school combination is legal:
 * - COACH / SCHOOL_LEADER → schoolId must exist and point to a real (non-home-office) school
 * - NETWORK_LEADER / NETWORK_ADMIN → schoolId must exist and point to the Home Office school
 * - includeInFeedbackTracker=true → schoolId must exist and point to a real (non-home-office) school
 * Returns an error string if invalid, or null if valid.
 */
async function validateRoleSchool(
  role: string,
  schoolId: number | null,
  includeInFeedbackTracker: boolean,
): Promise<string | null> {
  if (!schoolId) return "School is required for all users";

  const isSchoolRole   = SCHOOL_ASSIGNABLE_ROLES.includes(role as UserRole);
  const isNetworkRole  = NETWORK_ROLES.includes(role as UserRole);

  if (isSchoolRole) {
    if (!schoolId) return "Coaches and School Leaders must be assigned to a school";
    const isHO = await getSchoolHomeOfficeFlag(schoolId);
    if (isHO === null) return "School not found";
    if (isHO) return "Coaches and School Leaders must be assigned to a real school, not Home Office";
  }

  if (isNetworkRole) {
    if (!schoolId) return "Network Leaders and Network Admins must be assigned to the Home Office school";
    const isHO = await getSchoolHomeOfficeFlag(schoolId);
    if (isHO === null) return "School not found";
    if (!isHO) return "Network Leaders and Network Admins must be assigned to the Home Office school";
  }

  if (includeInFeedbackTracker) {
    if (!schoolId) return "Feedback tracker participants must be assigned to a school";
    const isHO = await getSchoolHomeOfficeFlag(schoolId);
    if (isHO === null) return "School not found";
    if (isHO) return "Feedback tracker participants must be assigned to a real school, not Home Office";
  }

  return null;
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

    /* includeInactive=true is an admin-only parameter — COACH may not enumerate
       deactivated people even within their own school.                          */
    if (includeInactive && currentUser.role === "COACH") {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    const schoolIdParam   = req.query.schoolId ? Number(req.query.schoolId) : null;

    if (!isNetworkScope && !currentUser.schoolId) {
      res.status(403).json({ error: "No school assigned to this user" });
      return;
    }

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
      /* Explicitly exclude Home Office school users — they are admin/network
         staff and should never appear as observable teachers.               */
      conditions.push(or(isNull(schools.isHomeOffice), eq(schools.isHomeOffice, false))!);
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
router.post("/", requireRole("SCHOOL_LEADER", "NETWORK_LEADER", "NETWORK_ADMIN"), async (req, res) => {
  try {
    const currentUser = req.user as Express.User;
    const isNetworkAdmin  = currentUser.role === "NETWORK_ADMIN";
    const isNetworkLeader = currentUser.role === "NETWORK_LEADER";
    const isNetworkScope  = isNetworkAdmin || isNetworkLeader;

    const {
      employeeId, firstName, lastName, email, role, schoolId,
      includeInFeedbackTracker, department, gradeLevel,
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

    if (!isNetworkScope) {
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

    const assignedSchoolId = isNetworkScope ? (schoolId ?? null) : currentUser.schoolId;

    /* ── Role/school Home Office validation ── */
    const roleSchoolError = await validateRoleSchool(
      role,
      assignedSchoolId,
      includeInFeedbackTracker ?? false,
    );
    if (roleSchoolError) {
      res.status(400).json({ error: roleSchoolError }); return;
    }

    const trimmedEmpId = employeeId?.trim();
    if (!trimmedEmpId) {
      res.status(400).json({ error: "employeeId is required" }); return;
    }

    const today = new Date().toISOString().slice(0, 10);

    const created = await db.transaction(async (tx) => {
      const [person] = await tx.insert(people).values({
        employeeId: trimmedEmpId,
        firstName:  firstName.trim(),
        lastName:   lastName.trim(),
        email:      trimmedEmail,
        role:       role as UserRole,
        schoolId:   assignedSchoolId,
        includeInFeedbackTracker: includeInFeedbackTracker ?? false,
        department:  department as typeof DEPARTMENT_VALUES[number] ?? null,
        gradeLevel:  gradeLevel ?? null,
      }).returning();

      await tx.insert(assignments).values({
        userId:    person!.employeeId,
        role:      role as UserRole,
        schoolId:  assignedSchoolId,
        startDate: today,
        endDate:   null,
      });

      return person!;
    });

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
    }>;

    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "Body must be a non-empty array of person objects" });
      return;
    }

    const allSchools = await db.select({
      id: schools.id,
      displayName: schools.displayName,
      fullName: schools.fullName,
      isHomeOffice: schools.isHomeOffice,
    }).from(schools);
    const schoolIdSet = new Set<number>(allSchools.map((s) => s.id));
    const schoolHomeOfficeMap = new Map<number, boolean>(allSchools.map((s) => [s.id, s.isHomeOffice]));
    /* Build lookup: fullName takes priority, fall back to displayName */
    const schoolNameMap = new Map<string, number>();
    for (const s of allSchools) {
      const dn = s.displayName.toLowerCase().trim();
      if (!schoolNameMap.has(dn)) schoolNameMap.set(dn, s.id);
    }
    for (const s of allSchools) {
      if (s.fullName) {
        const fn = s.fullName.toLowerCase().trim();
        schoolNameMap.set(fn, s.id);
      }
    }

    type RowResult = {
      row: number;
      status: "created" | "assigned" | "skipped" | "error";
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
      const deptRaw = typeof raw.department === "string" && raw.department.trim() ? raw.department.trim() : null;
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
          const byName = schoolNameMap.get(school.toLowerCase().trim());
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

      /* ── Universal: school is required for every user ── */
      if (!schoolId) {
        results.push({ row: rowNum, status: "error", name: displayName!, email, reason: "School is required for all users" });
        continue;
      }

      /* ── Role/school Home Office validation ── */
      const isSchoolRole   = SCHOOL_ASSIGNABLE_ROLES.includes(role as UserRole);
      const isNetworkRole  = NETWORK_ROLES.includes(role as UserRole);

      if (isSchoolRole) {
        if (!schoolId) {
          results.push({ row: rowNum, status: "error", name: displayName!, email, reason: "Coaches and School Leaders must be assigned to a school" });
          continue;
        }
        const isHO = schoolHomeOfficeMap.get(schoolId);
        if (isHO) {
          results.push({ row: rowNum, status: "error", name: displayName!, email, reason: "Coaches and School Leaders must be assigned to a real school, not Home Office" });
          continue;
        }
      }

      if (isNetworkRole) {
        if (!schoolId) {
          results.push({ row: rowNum, status: "error", name: displayName!, email, reason: "Network Leaders and Network Admins must be assigned to the Home Office school" });
          continue;
        }
        const isHO = schoolHomeOfficeMap.get(schoolId);
        if (!isHO) {
          results.push({ row: rowNum, status: "error", name: displayName!, email, reason: "Network Leaders and Network Admins must be assigned to the Home Office school" });
          continue;
        }
      }

      if (includeInFB) {
        if (!schoolId) {
          results.push({ row: rowNum, status: "error", name: displayName!, email, reason: "Feedback tracker participants must be assigned to a school" });
          continue;
        }
        const isHO = schoolHomeOfficeMap.get(schoolId);
        if (isHO) {
          results.push({ row: rowNum, status: "error", name: displayName!, email, reason: "Feedback tracker participants must be assigned to a real school, not Home Office" });
          continue;
        }
      }

      if (!employeeIdRaw) {
        results.push({ row: rowNum, status: "error", name: displayName ?? undefined, email: email ?? undefined, reason: "Missing employeeId" });
        continue;
      }
      const empId = employeeIdRaw;

      const bulkToday = new Date().toISOString().slice(0, 10);

      /* Walk the error / cause chain to find the PG error code */
      const pgCode = (e: unknown): string | null => {
        if (typeof e !== "object" || e === null) return null;
        const obj = e as Record<string, unknown>;
        if (typeof obj["code"] === "string") return obj["code"];
        return obj["cause"] ? pgCode(obj["cause"]) : null;
      };
      const pgMessage = (e: unknown): string | null => {
        if (typeof e !== "object" || e === null) return null;
        const obj = e as Record<string, unknown>;
        if (typeof obj["detail"] === "string") return obj["detail"];
        if (typeof obj["message"] === "string") return obj["message"];
        return obj["cause"] ? pgMessage(obj["cause"]) : null;
      };

      try {
        /* ── Step 1: Resolve existing person with conflict detection ── */
        /*
         * Query employeeId and email separately so that when both fields appear
         * in the database but on DIFFERENT records (dirty/migrated data), we
         * detect the conflict and reject the row rather than silently modifying
         * the wrong account.
         */
        const [byEmpId] = await db.select({
          employeeId: people.employeeId,
          role:       people.role,
          schoolId:   people.schoolId,
        }).from(people).where(eq(people.employeeId, empId)).limit(1);

        const [byEmail] = await db.select({
          employeeId: people.employeeId,
          role:       people.role,
          schoolId:   people.schoolId,
        }).from(people).where(eq(people.email, email!)).limit(1);

        if (byEmpId && byEmail && byEmpId.employeeId !== byEmail.employeeId) {
          /* Ambiguous: employeeId and email resolve to two different records */
          results.push({
            row:    rowNum,
            status: "error",
            name:   displayName!,
            email,
            reason: "employeeId and email match different existing records — check for data errors",
          });
        } else {
          const existingPerson = byEmpId ?? byEmail;

          if (existingPerson) {
            /* ── Existing person: upsert assignment + sync denormalized fields ── */
            let resultStatus: "assigned" | "skipped" = "skipped";
            let skipReason: string | undefined;

            await db.transaction(async (tx) => {
              /* Check for an active assignment (endDate IS NULL) */
              const [existingActive] = await tx.select({
                id:       assignments.id,
                role:     assignments.role,
                schoolId: assignments.schoolId,
              }).from(assignments).where(
                and(eq(assignments.userId, existingPerson.employeeId), isNull(assignments.endDate))
              ).limit(1);

              if (
                existingActive &&
                existingActive.role === role &&
                existingActive.schoolId === schoolId
              ) {
                /* Identical active assignment — no assignment write needed */
                skipReason = "Active assignment already exists with the same role and school";
                resultStatus = "skipped";
              } else {
                /* Close the existing active assignment if it differs */
                if (existingActive) {
                  await tx.update(assignments)
                    .set({ endDate: bulkToday })
                    .where(eq(assignments.id, existingActive.id));
                }

                /* ── Step 2: Create assignment for existing person ── */
                await tx.insert(assignments).values({
                  userId:    existingPerson.employeeId,
                  role,
                  schoolId,
                  startDate: bulkToday,
                  endDate:   null,
                });

                resultStatus = "assigned";
              }

              /* ── Step 3: ALWAYS sync denormalized role/schoolId ── */
              /*
               * Run even when the assignment is skipped (identical) — the people
               * record may have stale denormalized values from a previous partial
               * write, and session lookups depend on these fields being accurate.
               */
              if (existingPerson.role !== role || existingPerson.schoolId !== schoolId) {
                await tx.update(people)
                  .set({ role, schoolId })
                  .where(eq(people.employeeId, existingPerson.employeeId));
              }
            });

            /* ── Step 4: Return "assigned" or "skipped" ── */
            if (resultStatus === "skipped") {
              results.push({ row: rowNum, status: "skipped", name: displayName!, email, reason: skipReason });
            } else {
              results.push({ row: rowNum, status: "assigned", name: displayName!, email });
            }
          } else {
            /* ── New person: create person + assignment ── */
            await db.transaction(async (tx) => {
              await tx.insert(people).values({
                employeeId: empId,
                firstName:  firstName,
                lastName:   lastName ?? "",
                email,
                role,
                schoolId,
                includeInFeedbackTracker: includeInFB,
                department: deptRaw as typeof DEPARTMENT_VALUES[number] ?? null,
                gradeLevel: gradeLevel.length > 0 ? gradeLevel : null,
              });
              await tx.insert(assignments).values({
                userId:    empId,
                role,
                schoolId,
                startDate: bulkToday,
                endDate:   null,
              });
            });
            results.push({ row: rowNum, status: "created", name: displayName!, email });
          }
        }
      } catch (err: unknown) {
        const code    = pgCode(err);
        const message = pgMessage(err);
        console.error(`POST /people/bulk row ${rowNum} DB error [${code}]:`, message, err);
        if (code === "23505") {
          results.push({ row: rowNum, status: "skipped", name: displayName!, email, reason: "Duplicate email or employee ID" });
        } else {
          const hint = code ? `${code}: ${message ?? "unknown"}` : (message ?? "unknown database error");
          results.push({ row: rowNum, status: "error", name: displayName!, email, reason: `Database error — ${hint}` });
        }
      }
    }

    res.json({ results });
  } catch (err) {
    console.error("POST /people/bulk error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── Self-deactivation guard ──────────────────────────────────────
   Returns true when a user is about to set their own account to
   inactive. Used by both the general update and toggle-active routes. */
function isSelfDeactivation(currentUser: Express.User, empId: string, isActive: boolean | undefined): boolean {
  return empId === currentUser.employeeId && isActive === false;
}

/* ── PATCH /api/people/:employeeId ───────────────────────────────
   Update a person's fields.
   SCHOOL_LEADER: own school, school-scoped roles only.
   NETWORK_ADMIN: any person, any role.                             */
router.patch("/:employeeId", requireRole("SCHOOL_LEADER", "NETWORK_LEADER", "NETWORK_ADMIN"), async (req, res) => {
  try {
    const currentUser    = req.user as Express.User;
    const isNetworkAdmin = currentUser.role === "NETWORK_ADMIN";
    const isNetworkScope = isNetworkAdmin || currentUser.role === "NETWORK_LEADER";
    const empId = String(req.params.employeeId);

    const target = await db.query.people.findFirst({ where: eq(people.employeeId, empId) });
    if (!target) { res.status(404).json({ error: "Person not found" }); return; }

    if (!isNetworkScope) {
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

    /* Network-scope editors must use /reassign to change school */
    if (isNetworkScope && "schoolId" in req.body) {
      res.status(400).json({ error: "School changes must be made using the Reassign action" }); return;
    }

    const {
      firstName, lastName, email, role,
      includeInFeedbackTracker, department, gradeLevel,
      isActive,
    } = req.body as Partial<{
      firstName:               string;
      lastName:                string;
      email:                   string;
      role:                    UserRole;
      includeInFeedbackTracker: boolean;
      department:              string | null;
      gradeLevel:              string[] | null;
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
    if (!isNetworkScope && role && !SCHOOL_ASSIGNABLE_ROLES.includes(role) && role !== "NO_ACCESS") {
      res.status(403).json({ error: "School Leaders can only assign Coach or School Leader roles" }); return;
    }

    if (isSelfDeactivation(currentUser, empId, isActive)) {
      res.status(400).json({ error: "You cannot deactivate your own account" }); return;
    }

    const effectiveRole     = role ?? target.role;
    const effectiveSchoolId = target.schoolId;
    const effectiveInFT     = includeInFeedbackTracker !== undefined ? includeInFeedbackTracker : target.includeInFeedbackTracker;

    /* ── Role/school Home Office validation ── */
    if (isNetworkScope) {
      const roleSchoolError = await validateRoleSchool(
        effectiveRole,
        effectiveSchoolId,
        effectiveInFT,
      );
      if (roleSchoolError) {
        res.status(400).json({ error: roleSchoolError }); return;
      }
    } else {
      if (effectiveInFT && !effectiveSchoolId) {
        res.status(400).json({ error: "Users included in the feedback tracker must be assigned to a school" }); return;
      }
    }

    const updates: Record<string, unknown> = {};
    if (firstName !== undefined) updates.firstName = firstName.trim();
    if (lastName  !== undefined) updates.lastName  = lastName.trim();
    if (trimmedEmail !== undefined) updates.email  = trimmedEmail;
    if (role      !== undefined) updates.role      = role;
    if (includeInFeedbackTracker !== undefined) updates.includeInFeedbackTracker = includeInFeedbackTracker;
    if (department !== undefined) updates.department = department;
    if (gradeLevel !== undefined) updates.gradeLevel = gradeLevel;
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
router.patch("/:employeeId/toggle-active", requireRole("SCHOOL_LEADER", "NETWORK_LEADER", "NETWORK_ADMIN"), async (req, res) => {
  try {
    const currentUser    = req.user as Express.User;
    const isNetworkScope = currentUser.role === "NETWORK_ADMIN" || currentUser.role === "NETWORK_LEADER";
    const empId = String(req.params.employeeId);

    const target = await db.query.people.findFirst({ where: eq(people.employeeId, empId) });
    if (!target) { res.status(404).json({ error: "Person not found" }); return; }

    if (isSelfDeactivation(currentUser, empId, !target.isActive)) {
      res.status(400).json({ error: "You cannot deactivate your own account" }); return;
    }

    if (!isNetworkScope) {
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

/* ── POST /api/people/:employeeId/reassign ────────────────────────
   Close the current active Assignment (set end_date = today) and
   open a brand-new one with the new role + schoolId, also updating
   the people row so the session stays consistent.
   NETWORK_ADMIN only.                                               */
router.post("/:employeeId/reassign", requireRole("NETWORK_ADMIN"), async (req, res) => {
  try {
    const empId = String(req.params.employeeId);
    const { role, schoolId } = req.body as { role?: unknown; schoolId?: unknown };

    if (!role || typeof role !== "string" || !ALL_ROLES.includes(role as UserRole)) {
      res.status(400).json({ error: `Invalid role: ${String(role)}` }); return;
    }
    if (schoolId === undefined || schoolId === null || typeof schoolId !== "number") {
      res.status(400).json({ error: "schoolId (number) is required" }); return;
    }

    const target = await db.query.people.findFirst({ where: eq(people.employeeId, empId) });
    if (!target) { res.status(404).json({ error: "Person not found" }); return; }

    const roleSchoolError = await validateRoleSchool(role, schoolId as number, target.includeInFeedbackTracker);
    if (roleSchoolError) { res.status(400).json({ error: roleSchoolError }); return; }

    const today = new Date().toISOString().slice(0, 10);

    await db.transaction(async (tx) => {
      await tx
        .update(assignments)
        .set({ endDate: today })
        .where(and(eq(assignments.userId, empId), isNull(assignments.endDate)));

      await tx.insert(assignments).values({
        userId:    empId,
        role:      role as UserRole,
        schoolId:  schoolId as number,
        startDate: today,
        endDate:   null,
      });

      await tx
        .update(people)
        .set({ role: role as UserRole, schoolId: schoolId as number })
        .where(eq(people.employeeId, empId));
    });

    const [withSchool] = await db
      .select(PEOPLE_SELECT)
      .from(people)
      .leftJoin(schools, eq(people.schoolId, schools.id))
      .where(eq(people.employeeId, empId));

    if (!withSchool) { res.status(404).json({ error: "Person not found after update" }); return; }
    res.json(withName(withSchool));
  } catch (err) {
    console.error("POST /people/:employeeId/reassign error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

