import { Router } from "express";
import { db } from "@workspace/db";
import { people, schools, assignments, schoolYears } from "@workspace/db/schema";
import { eq, and, or, isNull, desc } from "drizzle-orm";
import { requireRole, assertNetworkSchoolAccess, canAccessSchoolScopedRecord, type UserRole } from "../middleware/auth";
import { DEPARTMENT_VALUES } from "@workspace/db/schema";
import {
  loadSchoolLookup,
  parseRosterRow,
  buildRosterPlan,
  applyRosterPlan,
  UnacknowledgedEmailChanges,
  type RosterRowInput,
  type ParsedRosterRow,
  type RosterRowError,
} from "../lib/roster";
import { dashboardCache } from "./dashboard";
import { districtCache }  from "./district";
import { networkAvgsCache } from "./action-center";
import { getActiveSchoolYearId } from "../lib/active-school-year";
import { parseGradeLevelsDetailed } from "../lib/grade-levels.js";

function invalidateAllCaches() {
  dashboardCache.invalidatePrefix("dashboard:");
  districtCache.invalidatePrefix("district:");
  networkAvgsCache.invalidatePrefix("network-avgs:");
}

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


/**
 * Grades, checked against the list this system recognises.
 *
 * Nothing validated them before: POST and PATCH wrote whatever they were
 * given straight into the database, so a teacher could be assigned to grade 13
 * — or, from a spreadsheet Excel had rewritten as a date, to "Oct 11". The
 * same rules the import uses apply here, so the two cannot disagree.
 *
 * Returns the cleaned list, or an error message naming what was wrong.
 */
function checkGradeLevels(raw: unknown): { grades: string[] } | { error: string } {
  if (raw === undefined || raw === null) return { grades: [] };
  const parsed = parseGradeLevelsDetailed(raw);
  if (parsed.invalid.length > 0) {
    const list = parsed.invalid.map((g) => `"${g}"`).join(", ");
    return { error: `Invalid grade level ${list}. Grades must be Pre-K, TK, K, or 1-12.` };
  }
  return { grades: parsed.grades };
}

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
   - schoolId=<n>                    → filter to school (network scope only)
   SCHOOL_LEADER / COACH: own school only
   NETWORK_LEADER / NETWORK_ADMIN: all schools; pass schoolId to narrow  */
router.get("/", requireRole("COACH", "SCHOOL_LEADER", "NETWORK_LEADER", "NETWORK_ADMIN"), async (req, res) => {
  try {
    const currentUser = req.user as Express.User;
    const isNetworkAdmin  = currentUser.role === "NETWORK_ADMIN";
    const isNetworkLeader = currentUser.role === "NETWORK_LEADER";
    const isNetworkScope  = isNetworkAdmin || isNetworkLeader;
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

    /* Validate that NETWORK_LEADER's requested school is within their scope.
       Omitting schoolId is allowed and lists people across every school —
       Network Leaders have organisation-wide visibility, same as NETWORK_ADMIN.
       School-specific screens narrow the list by passing schoolId explicitly. */
    if (isNetworkLeader && schoolIdParam) {
      const access = await assertNetworkSchoolAccess(currentUser, schoolIdParam);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error });
        return;
      }
    }

    const effectiveSchoolId = isNetworkScope
      ? (schoolIdParam ?? null)         // all schools unless one is named
      : currentUser.schoolId ?? null;   // COACH / SCHOOL_LEADER

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

    res.json(rows.map((row) => ({
      ...withName(row),
      schoolOrphaned: row.schoolId !== null && row.schoolName === null,
    })));
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

    const gradeCheck = checkGradeLevels(gradeLevel);
    if ("error" in gradeCheck) { res.status(400).json({ error: gradeCheck.error }); return; }

    if (!isNetworkScope) {
      if (!SCHOOL_ASSIGNABLE_ROLES.includes(role as UserRole)) {
        res.status(403).json({ error: "School Leaders can only create Coach or School Leader people" }); return;
      }
      if ((schoolId ?? currentUser.schoolId) !== currentUser.schoolId) {
        res.status(403).json({ error: "School Leaders can only create people in their own school" }); return;
      }
    }

    /* NETWORK_LEADER may not create network-level accounts (NETWORK_LEADER or
       NETWORK_ADMIN). Only NETWORK_ADMIN can mint those privileged roles.     */
    if (isNetworkLeader && NETWORK_ROLES.includes(role as UserRole)) {
      res.status(403).json({ error: "Network Leaders cannot create Network-level accounts" }); return;
    }

    /* NETWORK_LEADER may only create people in schools within their scope */
    if (isNetworkLeader && schoolId != null) {
      const access = await assertNetworkSchoolAccess(currentUser, schoolId);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error }); return;
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

    const activeSchoolYearId = await getActiveSchoolYearId();
    if (!activeSchoolYearId) {
      res.status(503).json({ error: "No active school year found — contact your administrator" }); return;
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
        gradeLevel:  gradeCheck.grades.length > 0 ? gradeCheck.grades : null,
      }).returning();

      await tx.insert(assignments).values({
        userId:       person!.employeeId,
        role:         role as UserRole,
        schoolId:     assignedSchoolId,
        schoolYearId: activeSchoolYearId,
        startDate:    today,
        endDate:      null,
      });

      return person!;
    });

    const [withSchool] = await db
      .select(PEOPLE_SELECT)
      .from(people)
      .leftJoin(schools, eq(people.schoolId, schools.id))
      .where(eq(people.employeeId, created.employeeId));

    invalidateAllCaches();
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
   Roster upload.

   Two body shapes are accepted:
     [ {...}, {...} ]                       legacy — writes into the active year
     { rows: [...], schoolYearId?, dryRun? } roster upload

   `schoolYearId` targets a year other than the active one — the staging path
   for a rollover. Staged uploads write assignment rows only; no person-level
   field changes until that year is activated, so preparing next year cannot
   disturb the year currently running. NETWORK_ADMIN only.

   `dryRun: true` computes the whole plan and writes nothing, returning the
   diff the admin confirms before the real upload. The preview and the write
   share one implementation — see lib/roster.ts.

   SCHOOL_LEADER: own school, active year, no staging.
   NETWORK_ADMIN: any school, any year.                              */
router.post("/bulk", requireRole("SCHOOL_LEADER", "NETWORK_ADMIN"), async (req, res) => {
  try {
    const currentUser = req.user as Express.User;
    const isNetworkAdmin = currentUser.role === "NETWORK_ADMIN";

    const body: unknown = req.body;
    const isEnvelope = !Array.isArray(body) && typeof body === "object" && body !== null;
    const envelope = (isEnvelope ? body : {}) as {
      rows?: unknown; schoolYearId?: unknown; dryRun?: unknown;
      acknowledgeEmailChanges?: unknown;
    };
    const rows = (isEnvelope ? envelope.rows : body) as RosterRowInput[];
    const dryRun = envelope.dryRun === true;

    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "Body must be a non-empty array of person objects, or { rows: [...] }" });
      return;
    }

    const activeSchoolYearId = await getActiveSchoolYearId();
    if (!activeSchoolYearId) {
      res.status(503).json({ error: "No active school year found — contact your administrator" });
      return;
    }

    /* ── Resolve the target year ── */
    let targetYearId = activeSchoolYearId;
    if (envelope.schoolYearId !== undefined && envelope.schoolYearId !== null) {
      const requested = Number(envelope.schoolYearId);
      if (!Number.isInteger(requested)) {
        res.status(400).json({ error: "schoolYearId must be an integer" });
        return;
      }
      if (requested !== activeSchoolYearId && !isNetworkAdmin) {
        res.status(403).json({ error: "Only Network Admins can stage a roster for another school year" });
        return;
      }
      const [year] = await db.select({ id: schoolYears.id })
        .from(schoolYears).where(eq(schoolYears.id, requested)).limit(1);
      if (!year) {
        res.status(404).json({ error: "School year not found" });
        return;
      }
      targetYearId = requested;
    }

    /* ── Parse every row before touching the database ── */
    const lookup = await loadSchoolLookup();
    const parseCtx = {
      lookup,
      isNetworkAdmin,
      callerSchoolId: currentUser.schoolId ?? null,
    };

    const parsed: ParsedRosterRow[] = [];
    const parseErrors: RosterRowError[] = [];
    for (let i = 0; i < rows.length; i++) {
      const outcome = parseRosterRow(rows[i]!, i + 1, parseCtx);
      if ("status" in outcome) parseErrors.push(outcome);
      else parsed.push(outcome);
    }

    const plan = await buildRosterPlan(parsed, parseErrors, {
      targetYearId,
      outgoingYearId: activeSchoolYearId,
      lookup,
      isNetworkAdmin,
      callerSchoolId: currentUser.schoolId ?? null,
    });

    /* ── Dry run: return the diff, write nothing ── */
    if (dryRun) {
      res.json({
        dryRun:         true,
        targetYearId:   plan.targetYearId,
        outgoingYearId: plan.outgoingYearId,
        staged:         plan.staged,
        counts:         plan.counts,
        bySchool:       plan.bySchool,
        departures:     plan.departures.map(({ assignmentId: _ignored, ...d }) => d),
        emailChanges:   plan.emailChanges,
        errors:         plan.errors,
      });
      return;
    }

    let results;
    try {
      results = await applyRosterPlan(plan, {
        acknowledgeEmailChanges: envelope.acknowledgeEmailChanges === true,
      });
    } catch (err) {
      if (err instanceof UnacknowledgedEmailChanges) {
        res.status(409).json({
          error: "This roster changes the sign-in address of existing people",
          code:  "EMAIL_CHANGES_NOT_ACKNOWLEDGED",
          emailChanges: err.changes,
        });
        return;
      }
      throw err;
    }

    invalidateAllCaches();
    res.json({
      results,
      targetYearId: plan.targetYearId,
      staged:       plan.staged,
      counts:       plan.counts,
    });
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

    const isNetworkLeader = currentUser.role === "NETWORK_LEADER";

    if (!isNetworkScope) {
      /* Fail closed: a caller with no school, or a target with no school,
         is denied rather than matching on null === null.                  */
      if (!canAccessSchoolScopedRecord(currentUser, target.schoolId)) {
        res.status(403).json({ error: "Cannot edit people from another school" }); return;
      }
      if (
        !SCHOOL_ASSIGNABLE_ROLES.includes(target.role as UserRole) &&
        target.role !== "NO_ACCESS"
      ) {
        res.status(403).json({ error: "Cannot edit Network-level people" }); return;
      }
    }

    /* NETWORK_LEADER may not edit accounts that already hold a network-level
       role — those belong exclusively to NETWORK_ADMIN jurisdiction.          */
    if (isNetworkLeader && NETWORK_ROLES.includes(target.role as UserRole)) {
      res.status(403).json({ error: "Network Leaders cannot edit Network-level accounts" }); return;
    }

    /* NETWORK_LEADER may only edit people in schools within their scope */
    if (isNetworkLeader && target.schoolId != null) {
      const access = await assertNetworkSchoolAccess(currentUser, target.schoolId);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error }); return;
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
    /* NETWORK_LEADER cannot promote anyone (including themselves) to a
       network-level role. Only NETWORK_ADMIN may assign those roles.   */
    if (isNetworkLeader && role && NETWORK_ROLES.includes(role)) {
      res.status(403).json({ error: "Network Leaders cannot assign Network-level roles" }); return;
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
    if (gradeLevel !== undefined) {
      const check = checkGradeLevels(gradeLevel);
      if ("error" in check) { res.status(400).json({ error: check.error }); return; }
      updates.gradeLevel = check.grades.length > 0 ? check.grades : null;
    }
    if (isActive   !== undefined) updates.isActive   = isActive;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "Nothing to update" }); return;
    }

    /* ── Keep the assignment ledger in step with a role change ──────────
       people.role is a denormalised copy; `assignments` is the historical
       record of who held which role, at which school, in which year.
       Writing only the copy left the ledger silently wrong, so a role
       change made here was invisible to any audit of it. /reassign has
       always done this correctly; this mirrors it.

       Deliberately conservative: the ledger is only rewritten when an OPEN
       assignment already exists for the active year. If the person has no
       open assignment for this year, none is fabricated — editing someone's
       role should not quietly scope them into a year they were not part of,
       which is what checkActiveThisYear keys off.                        */
    const roleChanged = role !== undefined && role !== target.role;
    const activeYearIdForLedger = roleChanged ? await getActiveSchoolYearId() : null;

    await db.transaction(async (tx) => {
      await tx
        .update(people)
        .set(updates as Partial<typeof people.$inferInsert>)
        .where(eq(people.employeeId, empId));

      if (!roleChanged || activeYearIdForLedger === null) return;

      const [openAssignment] = await tx
        .select({ id: assignments.id, schoolId: assignments.schoolId })
        .from(assignments)
        .where(and(
          eq(assignments.userId, empId),
          eq(assignments.schoolYearId, activeYearIdForLedger),
          isNull(assignments.endDate),
        ))
        .limit(1);

      if (!openAssignment) return;

      const today = new Date().toISOString().slice(0, 10);

      /* Close then reopen, rather than updating in place, so the ledger keeps
         the previous role as history. The partial unique index on
         (user_id, school_year_id) WHERE end_date IS NULL requires these to be
         in one transaction — there must never be two open rows. */
      await tx
        .update(assignments)
        .set({ endDate: today })
        .where(eq(assignments.id, openAssignment.id));

      await tx.insert(assignments).values({
        userId:       empId,
        role:         role as UserRole,
        schoolId:     openAssignment.schoolId,
        schoolYearId: activeYearIdForLedger,
        startDate:    today,
        endDate:      null,
      });
    });

    const [withSchool] = await db
      .select(PEOPLE_SELECT)
      .from(people)
      .leftJoin(schools, eq(people.schoolId, schools.id))
      .where(eq(people.employeeId, empId));

    if (!withSchool) { res.status(404).json({ error: "Person not found" }); return; }
    invalidateAllCaches();
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
      /* Fail closed: a caller with no school, or a target with no school,
         is denied rather than matching on null === null.                  */
      if (!canAccessSchoolScopedRecord(currentUser, target.schoolId)) {
        res.status(403).json({ error: "Cannot edit people from another school" }); return;
      }
      if (!SCHOOL_ASSIGNABLE_ROLES.includes(target.role as UserRole) && target.role !== "NO_ACCESS") {
        res.status(403).json({ error: "Cannot edit Network-level people" }); return;
      }
    }

    /* NETWORK_LEADER may not activate or deactivate network-level accounts.
       Only NETWORK_ADMIN has that authority.                                */
    if (currentUser.role === "NETWORK_LEADER" && NETWORK_ROLES.includes(target.role as UserRole)) {
      res.status(403).json({ error: "Network Leaders cannot activate or deactivate Network-level accounts" }); return;
    }

    /* NETWORK_LEADER may only toggle-active people in schools within their scope */
    if (currentUser.role === "NETWORK_LEADER" && target.schoolId != null) {
      const access = await assertNetworkSchoolAccess(currentUser, target.schoolId);
      if (!access.ok) {
        res.status(access.status).json({ error: access.error }); return;
      }
    }

    const reactivating = target.isActive === false;

    /* ── Reactivation must also put them back on this year's roster ──────
       isActive and the assignments ledger are two different gates, and
       flipping only the first produced an account that looks active in the
       Users tab and cannot sign in. checkActiveThisYear() requires an OPEN
       assignment in the active year for anyone with assignment history; with
       none, requireAuth 403s every API call, so the dashboard loads its shell
       and then dies on the first fetch.

       Reported from production: a person reactivated after the rollover got a
       blank dashboard for a few seconds and then a white screen. The only
       thing that fixed it was reassigning them to the school they were
       already in — because /reassign writes the assignment row that this
       route never did.

       Mirrors checkActiveThisYear() deliberately, including its carve-outs:
       somebody with no assignment history at all is not blocked, so no row is
       fabricated for them. Nothing happens on deactivation — closing the
       assignment there is the rollover's job, and it holds the history the
       departure calculation reads. */
    const activeYearId = reactivating ? await getActiveSchoolYearId() : null;

    const [updated] = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(people)
        .set({ isActive: !target.isActive })
        .where(eq(people.employeeId, empId))
        .returning();

      if (!reactivating || activeYearId === null) return [row];

      const [anyHistory] = await tx
        .select({ id: assignments.id, schoolId: assignments.schoolId })
        .from(assignments)
        .where(eq(assignments.userId, empId))
        .orderBy(desc(assignments.startDate), desc(assignments.id))
        .limit(1);

      /* No history — checkActiveThisYear lets them through already. */
      if (!anyHistory) return [row];

      const [alreadyOpen] = await tx
        .select({ id: assignments.id })
        .from(assignments)
        .where(and(
          eq(assignments.userId, empId),
          eq(assignments.schoolYearId, activeYearId),
          isNull(assignments.endDate),
        ))
        .limit(1);

      if (alreadyOpen) return [row];

      /* people.schoolId is the current truth and what the admin UI shows;
         fall back to the last assignment's school when it is null, so a
         person with a blank school still comes back able to sign in. */
      const schoolIdForRow = target.schoolId ?? anyHistory.schoolId;

      await tx.insert(assignments).values({
        userId:       empId,
        role:         target.role as UserRole,
        schoolId:     schoolIdForRow,
        schoolYearId: activeYearId,
        startDate:    new Date().toISOString().slice(0, 10),
        endDate:      null,
      });

      return [row];
    });

    const [withSchool] = await db
      .select(PEOPLE_SELECT)
      .from(people)
      .leftJoin(schools, eq(people.schoolId, schools.id))
      .where(eq(people.employeeId, updated.employeeId));

    invalidateAllCaches();
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

    const activeSchoolYearId = await getActiveSchoolYearId();
    if (!activeSchoolYearId) {
      res.status(503).json({ error: "No active school year found — contact your administrator" }); return;
    }

    const today = new Date().toISOString().slice(0, 10);

    await db.transaction(async (tx) => {
      /* Close the open assignment for this user in the active school year only.
         Prior-year records are left untouched to preserve history. */
      await tx
        .update(assignments)
        .set({ endDate: today })
        .where(
          and(
            eq(assignments.userId, empId),
            eq(assignments.schoolYearId, activeSchoolYearId),
            isNull(assignments.endDate),
          ),
        );

      await tx.insert(assignments).values({
        userId:       empId,
        role:         role as UserRole,
        schoolId:     schoolId as number,
        schoolYearId: activeSchoolYearId,
        startDate:    today,
        endDate:      null,
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
    invalidateAllCaches();
    res.json(withName(withSchool));
  } catch (err) {
    console.error("POST /people/:employeeId/reassign error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
