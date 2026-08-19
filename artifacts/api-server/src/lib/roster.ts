/**
 * Roster parsing, classification and diffing for the school-year rollover.
 *
 * A roster upload is the authoritative statement of who works where for one
 * school year. Everyone on it is assigned; anyone holding an open assignment
 * in the OUTGOING year who is absent from it has left, and is deactivated when
 * the year flips.
 *
 * ── Why this is a module and not inline in routes/people.ts ────────────────
 * The same parse-and-classify pass runs three times with different endings:
 * a dry run that writes nothing, a staged write into a future year, and the
 * ordinary mid-year write into the active year. Sharing one implementation is
 * what makes the dry-run preview trustworthy — a preview computed by different
 * code from the write it previews is a preview of nothing.
 *
 * ── Staged vs live ────────────────────────────────────────────────────────
 * When the target year is not the active year the upload is STAGED: it writes
 * assignment rows dated to the target year and nothing else. No person-level
 * field is touched — not isActive, not the denormalized role/schoolId — so the
 * currently active year is completely undisturbed while the next one is being
 * prepared. Those deferred effects are applied by the activation flip.
 *
 * Staged rows are invisible to users because every read route filters on the
 * active school year. See routes/dashboard.ts and routes/observations.ts.
 */

import { db } from "@workspace/db";
import { people, schools, assignments } from "@workspace/db/schema";
import { eq, and, ne, isNull, sql } from "drizzle-orm";
import { DEPARTMENT_VALUES } from "@workspace/db/schema";
import type { UserRole } from "../middleware/auth";
import { parseGradeLevels } from "./grade-levels";
import { canonicalEmployeeId } from "./employee-id";

const SCHOOL_ASSIGNABLE_ROLES: UserRole[] = ["COACH", "SCHOOL_LEADER"];
const NETWORK_ROLES: UserRole[] = ["NETWORK_LEADER", "NETWORK_ADMIN"];
const ALL_ROLES: UserRole[] = ["COACH", "SCHOOL_LEADER", "NETWORK_LEADER", "NETWORK_ADMIN", "NO_ACCESS"];

export type Department = typeof DEPARTMENT_VALUES[number];


/** One row as it arrives from the client — every field untrusted. */
export interface RosterRowInput {
  firstName?:                unknown;
  lastName?:                 unknown;
  name?:                     unknown;
  employeeId?:               unknown;
  email?:                    unknown;
  role?:                     unknown;
  school?:                   unknown;
  includeInFeedbackTracker?: unknown;
  department?:               unknown;
  gradeLevel?:               unknown;
}

/** A row that passed every syntactic and referential check. */
export interface ParsedRosterRow {
  row:        number;
  employeeId: string;
  firstName:  string;
  lastName:   string;
  displayName: string;
  email:      string;
  role:       UserRole;
  schoolId:   number;
  includeInFeedbackTracker: boolean;
  department: Department | null;
  gradeLevel: string[] | null;
}

export interface RosterRowError {
  row:     number;
  status:  "error";
  name?:   string;
  email?:  string;
  reason:  string;
}

export interface SchoolLookup {
  idSet:        Set<number>;
  homeOffice:   Map<number, boolean>;
  /** lowercased fullName and displayName → id. fullName wins. */
  byName:       Map<string, number>;
  displayName:  Map<number, string>;
}

/** Load every school once so row validation needs no further queries. */
export async function loadSchoolLookup(): Promise<SchoolLookup> {
  const all = await db.select({
    id:           schools.id,
    displayName:  schools.displayName,
    fullName:     schools.fullName,
    isHomeOffice: schools.isHomeOffice,
  }).from(schools);

  const byName = new Map<string, number>();
  /* displayName first, then fullName — fullName overwrites so it takes priority */
  for (const s of all) {
    const dn = s.displayName.toLowerCase().trim();
    if (!byName.has(dn)) byName.set(dn, s.id);
  }
  for (const s of all) {
    if (s.fullName) byName.set(s.fullName.toLowerCase().trim(), s.id);
  }

  return {
    idSet:       new Set(all.map((s) => s.id)),
    homeOffice:  new Map(all.map((s) => [s.id, s.isHomeOffice])),
    byName,
    displayName: new Map(all.map((s) => [s.id, s.displayName])),
  };
}

export interface ParseContext {
  lookup:         SchoolLookup;
  isNetworkAdmin: boolean;
  /** SCHOOL_LEADER callers can only import into their own school. */
  callerSchoolId: number | null;
}

/**
 * Parse and validate one row. Returns either a fully-normalised row or the
 * single reason it was rejected. Pure apart from the pre-loaded lookup — no
 * database access, so a dry run costs nothing extra.
 */
export function parseRosterRow(
  raw: RosterRowInput,
  rowNum: number,
  ctx: ParseContext,
): ParsedRosterRow | RosterRowError {
  const err = (reason: string, name?: string, email?: string): RosterRowError =>
    ({ row: rowNum, status: "error", ...(name ? { name } : {}), ...(email ? { email } : {}), reason });

  /* ── Name: prefer firstName/lastName, fall back to splitting `name` ── */
  let firstName = "";
  let lastName  = "";
  if (typeof raw.firstName === "string" && raw.firstName.trim()) {
    firstName = raw.firstName.trim();
    lastName  = typeof raw.lastName === "string" ? raw.lastName.trim() : "";
  } else if (typeof raw.name === "string" && raw.name.trim()) {
    const parts = raw.name.trim().split(/\s+/);
    firstName = parts[0] ?? "";
    lastName  = parts.slice(1).join(" ");
  }
  if (!firstName) return err("Missing firstName (or name)");

  const displayName = `${firstName} ${lastName}`.trim();

  const email = typeof raw.email === "string" && raw.email.trim()
    ? raw.email.trim().toLowerCase()
    : null;
  if (!email) return err("Missing email", displayName);
  if (!email.includes("@")) return err("Invalid email address", displayName, email);

  const roleRaw = typeof raw.role === "string" ? raw.role.trim().toUpperCase() : null;
  const role = (roleRaw ?? "NO_ACCESS") as UserRole;
  if (!ALL_ROLES.includes(role)) return err(`Invalid role "${String(raw.role)}"`, displayName, email);

  const deptRaw = typeof raw.department === "string" && raw.department.trim()
    ? raw.department.trim()
    : null;
  if (deptRaw && !DEPARTMENT_VALUES.includes(deptRaw as Department)) {
    return err(`Invalid department "${deptRaw}"`, displayName, email);
  }

  const includeInFeedbackTracker =
    typeof raw.includeInFeedbackTracker === "string"
      ? raw.includeInFeedbackTracker.toLowerCase() === "true"
      : typeof raw.includeInFeedbackTracker === "boolean"
        ? raw.includeInFeedbackTracker
        : false;

  const gradeLevel = parseGradeLevels(raw.gradeLevel);

  /* ── School resolution ── */
  let schoolId: number | null = null;
  if (ctx.isNetworkAdmin) {
    const school = typeof raw.school === "string" ? raw.school.trim() : null;
    if (school) {
      const byName = ctx.lookup.byName.get(school.toLowerCase().trim());
      if (byName !== undefined) {
        schoolId = byName;
      } else {
        const asNum = Number(school);
        if (!Number.isNaN(asNum) && ctx.lookup.idSet.has(asNum)) schoolId = asNum;
        else return err(`School "${school}" not found`, displayName, email);
      }
    }
  } else {
    schoolId = ctx.callerSchoolId;
    if (!SCHOOL_ASSIGNABLE_ROLES.includes(role) && role !== "NO_ACCESS") {
      return err("School Leaders cannot import Network-level roles", displayName, email);
    }
  }
  if (!schoolId) return err("School is required for all users", displayName, email);

  /* ── Role / school-type agreement ── */
  const isHO = ctx.lookup.homeOffice.get(schoolId) ?? false;
  if (SCHOOL_ASSIGNABLE_ROLES.includes(role) && isHO) {
    return err("Coaches and School Leaders must be assigned to a real school, not Home Office", displayName, email);
  }
  if (NETWORK_ROLES.includes(role) && !isHO) {
    return err("Network Leaders and Network Admins must be assigned to the Home Office school", displayName, email);
  }
  if (includeInFeedbackTracker && isHO) {
    return err("Feedback tracker participants must be assigned to a real school, not Home Office", displayName, email);
  }

  const employeeId = typeof raw.employeeId === "string" && raw.employeeId.trim()
    ? raw.employeeId.trim()
    : null;
  if (!employeeId) return err("Missing employeeId", displayName, email);

  return {
    row: rowNum,
    employeeId,
    firstName,
    lastName,
    displayName,
    email,
    role,
    schoolId,
    includeInFeedbackTracker,
    department: (deptRaw as Department | null) ?? null,
    gradeLevel: gradeLevel.length > 0 ? gradeLevel : null,
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Classification                                                             */
/* ────────────────────────────────────────────────────────────────────────── */

export type RosterActionKind =
  /** No such person yet — create the person row and a target-year assignment. */
  | "create"
  /** Person exists; write a target-year assignment (new, or replacing a differing one). */
  | "assign"
  /** Person already has an identical open assignment in the target year. */
  | "unchanged";

export interface RosterAction {
  kind:       RosterActionKind;
  parsed:     ParsedRosterRow;
  /** Existing open assignment in the target year, if any. */
  existingAssignmentId: number | null;
  /** School they held in the outgoing year — null if they had none. */
  previousSchoolId: number | null;
  previousRole:     UserRole | null;
  /** True when previousSchoolId is set and differs from the roster's school. */
  isSchoolMove: boolean;
  isRoleChange: boolean;
}

export interface Departure {
  employeeId: string;
  name:       string;
  email:      string;
  schoolId:   number | null;
  schoolName: string | null;
  /** The open outgoing-year assignment that will be end-dated at the flip. */
  assignmentId: number;
}

export interface SchoolBreakdown {
  schoolId:    number;
  schoolName:  string;
  newHires:    number;
  schoolMoves: number;
  roleChanges: number;
  unchanged:   number;
  departures:  number;
  /** How many people will hold an assignment at this school in the target year. */
  remaining:   number;
}

export interface RosterPlan {
  targetYearId:   number;
  outgoingYearId: number | null;
  /** True when the target year is not the active year — person writes are deferred. */
  staged:         boolean;
  actions:        RosterAction[];
  errors:         RosterRowError[];
  departures:     Departure[];
  bySchool:       SchoolBreakdown[];
  counts: {
    newHires:    number;
    schoolMoves: number;
    roleChanges: number;
    unchanged:   number;
    departures:  number;
    errors:      number;
    /** Active staff absent from this roster whose departure CANNOT be
        detected, because they hold no open assignment in the outgoing year.
        Non-zero means the departure list above is incomplete. */
    undetectable: number;
    /** Rows matched to an existing person only after ignoring leading zeros
        in the employee ID — i.e. the export dropped the padding. */
    idNormalised: number;
  };
}

/**
 * Resolve every parsed row against the database and work out what the upload
 * would do, without doing any of it.
 *
 * Identity is `employeeId`. A row whose employeeId matches an existing person
 * whose email differs is an ERROR, never an auto-merge: the two plausible
 * causes — a mistyped ID, and a genuine email change — call for opposite
 * fixes, and picking wrong silently rewrites the wrong person's record.
 */
export async function buildRosterPlan(
  parsedRows: ParsedRosterRow[],
  parseErrors: RosterRowError[],
  opts: {
    targetYearId:   number;
    outgoingYearId: number | null;
    lookup:         SchoolLookup;
    isNetworkAdmin: boolean;
    callerSchoolId: number | null;
  },
): Promise<RosterPlan> {
  const { targetYearId, outgoingYearId, lookup } = opts;
  const errors: RosterRowError[] = [...parseErrors];
  const actions: RosterAction[] = [];
  let idNormalised = 0;

  /* Duplicate employeeIds within one file would race each other on write. */
  const seen = new Map<string, number>();
  const unique: ParsedRosterRow[] = [];
  for (const p of parsedRows) {
    const first = seen.get(p.employeeId);
    if (first !== undefined) {
      errors.push({
        row: p.row, status: "error", name: p.displayName, email: p.email,
        reason: `Duplicate employeeId "${p.employeeId}" — also on row ${first}`,
      });
      continue;
    }
    seen.set(p.employeeId, p.row);
    unique.push(p);
  }

  /*
   * Load everyone once instead of two queries per row. At roster scale that
   * is 2 lookups rather than ~4400, and it is what makes canonical-id
   * matching possible without a scan per row.
   */
  const allPeople = await db.select({
    employeeId: people.employeeId,
    email:      people.email,
    role:       people.role,
    schoolId:   people.schoolId,
  }).from(people);

  const byExactId  = new Map(allPeople.map((r) => [r.employeeId, r]));
  const byEmailMap = new Map(allPeople.map((r) => [r.email.toLowerCase(), r]));
  const byCanonId  = new Map<string, typeof allPeople>();
  for (const r of allPeople) {
    const key = canonicalEmployeeId(r.employeeId);
    const bucket = byCanonId.get(key);
    if (bucket) bucket.push(r);
    else byCanonId.set(key, [r]);
  }

  for (const p of unique) {
    let byEmpId = byExactId.get(p.employeeId);

    /* No exact hit — try ignoring leading zeros before declaring them new. */
    if (!byEmpId) {
      const candidates = byCanonId.get(canonicalEmployeeId(p.employeeId)) ?? [];
      if (candidates.length === 1) {
        byEmpId = candidates[0]!;
        idNormalised++;
      } else if (candidates.length > 1) {
        /* Two stored ids differ only by padding. Refuse: picking either one
           writes to a real person's record on a coin flip. */
        errors.push({
          row: p.row, status: "error", name: p.displayName, email: p.email,
          reason: `employeeId ${p.employeeId} matches more than one record ` +
                  `(${candidates.map((c) => c.employeeId).join(", ")}) — these differ only by leading zeros`,
        });
        continue;
      }
    }

    const byEmail = byEmailMap.get(p.email);

    /* employeeId and email point at two different humans — refuse to guess. */
    if (byEmpId && byEmail && byEmpId.employeeId !== byEmail.employeeId) {
      errors.push({
        row: p.row, status: "error", name: p.displayName, email: p.email,
        reason: "employeeId and email match different existing records — check for data errors",
      });
      continue;
    }
    /* employeeId is known but carries a different email. Could be a mistyped
       ID or a genuine rename; the fixes are opposite, so a human decides. */
    if (byEmpId && byEmpId.email !== p.email) {
      errors.push({
        row: p.row, status: "error", name: p.displayName, email: p.email,
        reason: `employeeId ${p.employeeId} already belongs to ${byEmpId.email} — resolve the email change before uploading`,
      });
      continue;
    }
    /* Email is known but under a different employeeId, and that ID is not in
       the roster. Same reasoning — do not silently re-key a person. */
    if (!byEmpId && byEmail) {
      errors.push({
        row: p.row, status: "error", name: p.displayName, email: p.email,
        reason: `${p.email} already exists under employeeId ${byEmail.employeeId} — resolve the ID change before uploading`,
      });
      continue;
    }

    /* From here on the stored id is authoritative: a row matched by canonical
       id must not create a second person under the unpadded form. */
    if (byEmpId) p.employeeId = byEmpId.employeeId;

    /* SCHOOL_LEADER callers may not reach into another school's records. */
    if (!opts.isNetworkAdmin && byEmpId && byEmpId.schoolId !== null && byEmpId.schoolId !== opts.callerSchoolId) {
      errors.push({
        row: p.row, status: "error", name: p.displayName, email: p.email,
        reason: "School Leaders can only manage users within their own school",
      });
      continue;
    }

    /* Existing open assignment in the TARGET year */
    const [inTarget] = byEmpId ? await db.select({
      id:       assignments.id,
      role:     assignments.role,
      schoolId: assignments.schoolId,
    }).from(assignments).where(and(
      eq(assignments.userId, p.employeeId),
      eq(assignments.schoolYearId, targetYearId),
      isNull(assignments.endDate),
    )).limit(1) : [undefined];

    /* Their standing in the OUTGOING year, for move/role-change detection */
    const [inOutgoing] = byEmpId && outgoingYearId !== null && outgoingYearId !== targetYearId
      ? await db.select({
          role:     assignments.role,
          schoolId: assignments.schoolId,
        }).from(assignments).where(and(
          eq(assignments.userId, p.employeeId),
          eq(assignments.schoolYearId, outgoingYearId),
          isNull(assignments.endDate),
        )).limit(1)
      : [undefined];

    /* Baseline for "did anything change": the outgoing year's assignment when
       there is one, otherwise the target year's, otherwise the denormalised
       person record (all a brand-new year has to go on). */
    const baseline = inOutgoing ?? inTarget ?? (byEmpId
      ? { role: byEmpId.role as UserRole, schoolId: byEmpId.schoolId }
      : undefined);

    const previousSchoolId = baseline?.schoolId ?? null;
    const previousRole     = (baseline?.role as UserRole | undefined) ?? null;

    let kind: RosterActionKind;
    if (!byEmpId) {
      kind = "create";
    } else if (inTarget && inTarget.role === p.role && inTarget.schoolId === p.schoolId) {
      kind = "unchanged";
    } else {
      kind = "assign";
    }

    actions.push({
      kind,
      parsed: p,
      existingAssignmentId: inTarget?.id ?? null,
      previousSchoolId,
      previousRole,
      isSchoolMove: kind !== "create" && previousSchoolId !== null && previousSchoolId !== p.schoolId,
      isRoleChange: kind !== "create" && previousRole !== null && previousRole !== p.role,
    });
  }

  const departures = await computeDepartures({
    targetYearId,
    outgoingYearId,
    lookup,
    alsoAssigned: new Set(actions.map((a) => a.parsed.employeeId)),
  });

  /* ── Per-school breakdown ── */
  const bySchool = new Map<number, SchoolBreakdown>();
  const bucket = (schoolId: number): SchoolBreakdown => {
    let b = bySchool.get(schoolId);
    if (!b) {
      b = {
        schoolId,
        schoolName:  lookup.displayName.get(schoolId) ?? `School ${schoolId}`,
        newHires: 0, schoolMoves: 0, roleChanges: 0, unchanged: 0, departures: 0, remaining: 0,
      };
      bySchool.set(schoolId, b);
    }
    return b;
  };

  for (const a of actions) {
    const b = bucket(a.parsed.schoolId);
    b.remaining += 1;
    if (a.kind === "create") b.newHires += 1;
    else if (a.kind === "unchanged") b.unchanged += 1;
    if (a.isSchoolMove) b.schoolMoves += 1;
    if (a.isRoleChange) b.roleChanges += 1;
  }
  for (const d of departures) {
    if (d.schoolId !== null) bucket(d.schoolId).departures += 1;
  }

  /* Anyone already staged into the target year by an earlier upload still
     counts toward that school's headcount — otherwise a second, smaller
     upload would look like it had emptied the school. */
  const alreadyStaged = await db.select({
    schoolId: assignments.schoolId,
    userId:   assignments.userId,
  }).from(assignments).where(and(
    eq(assignments.schoolYearId, targetYearId),
    isNull(assignments.endDate),
  ));
  const inThisUpload = new Set(actions.map((a) => a.parsed.employeeId));
  for (const row of alreadyStaged) {
    if (row.schoolId === null || inThisUpload.has(row.userId)) continue;
    bucket(row.schoolId).remaining += 1;
  }

  const counts = {
    newHires:    actions.filter((a) => a.kind === "create").length,
    schoolMoves: actions.filter((a) => a.isSchoolMove).length,
    roleChanges: actions.filter((a) => a.isRoleChange).length,
    unchanged:   actions.filter((a) => a.kind === "unchanged").length,
    departures:  departures.length,
    errors:      errors.length,
    idNormalised,
    undetectable: await countUndetectable({
      targetYearId,
      outgoingYearId,
      alsoAssigned: new Set(actions.map((a) => a.parsed.employeeId)),
    }),
  };

  return {
    targetYearId,
    outgoingYearId,
    staged: outgoingYearId !== null && outgoingYearId !== targetYearId,
    actions,
    errors: errors.sort((a, b) => a.row - b.row),
    departures,
    bySchool: [...bySchool.values()].sort((a, b) => a.schoolName.localeCompare(b.schoolName)),
    counts,
  };
}

/**
 * Everyone holding an open assignment in the outgoing year who will have no
 * assignment in the target year.
 *
 * Deliberately computed, never stored. The roster is the statement of who is
 * present; departure is the absence of a statement, and absence cannot be
 * recorded at upload time without going stale the moment a second roster file
 * is uploaded. The activation flip runs this same function with an empty
 * `alsoAssigned` set to get the authoritative list.
 *
 * ── The empty-year rule ───────────────────────────────────────────────────
 * "The incoming year is empty" and "everyone resigned" are not the same
 * statement, but the naive NOT-EXISTS reading cannot tell them apart: against
 * an empty year every single person qualifies as departed. So when the target
 * year says nothing about anyone — no staged rows AND no pending upload —
 * there are no departures.
 *
 * A pending upload IS a statement, even into a completely empty year. That is
 * the ordinary first-roster case, and everyone absent from that file really
 * has left. The distinction is between "no roster" and "a roster that omits
 * you", not between empty and non-empty.
 */
export async function computeDepartures(opts: {
  targetYearId:   number;
  outgoingYearId: number | null;
  lookup:         SchoolLookup;
  /** employeeIds that a pending (unwritten) upload would assign. */
  alsoAssigned:   Set<string>;
}): Promise<Departure[]> {
  const { targetYearId, outgoingYearId, lookup, alsoAssigned } = opts;
  if (outgoingYearId === null || outgoingYearId === targetYearId) return [];

  const outgoing = await db.select({
    assignmentId: assignments.id,
    employeeId:   people.employeeId,
    firstName:    people.firstName,
    lastName:     people.lastName,
    email:        people.email,
    schoolId:     assignments.schoolId,
  })
    .from(assignments)
    .innerJoin(people, eq(people.employeeId, assignments.userId))
    .where(and(
      eq(assignments.schoolYearId, outgoingYearId),
      isNull(assignments.endDate),
      /* Admins are active in every year and are not rostered, so absence
         from a roster says nothing about them. This must stay in step with
         the same exclusion in the activation flip — a preview that reports
         a departure the flip will not perform is a preview of nothing. */
      ne(people.role, "NETWORK_ADMIN"),
    ));

  if (outgoing.length === 0) return [];

  const staged = await db.select({ userId: assignments.userId })
    .from(assignments)
    .where(and(
      eq(assignments.schoolYearId, targetYearId),
      isNull(assignments.endDate),
    ));

  /* Nothing staged and nothing pending — the target year makes no claim about
     who works here, so it cannot be evidence that anyone left. */
  if (staged.length === 0 && alsoAssigned.size === 0) return [];

  const present = new Set(staged.map((s) => s.userId));

  return outgoing
    .filter((o) => !present.has(o.employeeId) && !alsoAssigned.has(o.employeeId))
    .map((o) => ({
      employeeId:   o.employeeId,
      name:         `${o.firstName} ${o.lastName}`.trim(),
      email:        o.email,
      schoolId:     o.schoolId,
      schoolName:   o.schoolId !== null ? lookup.displayName.get(o.schoolId) ?? null : null,
      assignmentId: o.assignmentId,
    }));
}

/**
 * How many active staff this roster leaves out AND cannot speak for.
 *
 * Departure detection reads the outgoing year's assignment ledger, so someone
 * with no open assignment there is invisible to it: absent from the roster,
 * never reported, never deactivated. That is a silent under-report of the one
 * list the whole rollover asks you to check.
 *
 * It is not hypothetical. The ledger only ever gets rows from the roster
 * upload, POST /people, the bulk upsert and reassign, so every person who
 * predates those is invisible — 2113 of 2115 when this was first measured.
 * lib/db/src/backfill-assignments.ts is the repair; this is the alarm that
 * says whether the repair is still needed.
 */
async function countUndetectable(opts: {
  targetYearId:   number;
  outgoingYearId: number | null;
  alsoAssigned:   Set<string>;
}): Promise<number> {
  const { targetYearId, outgoingYearId, alsoAssigned } = opts;
  if (outgoingYearId === null || outgoingYearId === targetYearId) return 0;

  const rows = await db.select({ employeeId: people.employeeId })
    .from(people)
    .where(and(
      eq(people.isActive, true),
      ne(people.role, "NETWORK_ADMIN"),
      /* No open assignment in the outgoing year → invisible to departures */
      sql`NOT EXISTS (SELECT 1 FROM assignments o
                       WHERE o.user_id = ${people.employeeId}
                         AND o.school_year_id = ${outgoingYearId}
                         AND o.end_date IS NULL)`,
      /* Already staged into the target year → accounted for, not missing */
      sql`NOT EXISTS (SELECT 1 FROM assignments t
                       WHERE t.user_id = ${people.employeeId}
                         AND t.school_year_id = ${targetYearId}
                         AND t.end_date IS NULL)`,
    ));

  return rows.filter((r) => !alsoAssigned.has(r.employeeId)).length;
}

/**
 * Whether anyone at all is rostered for a year. The activation gate uses this
 * to refuse to flip into an empty year — the state that 403'd every user.
 */
export async function yearHasRoster(schoolYearId: number): Promise<boolean> {
  const [row] = await db.select({ id: assignments.id })
    .from(assignments)
    .where(and(eq(assignments.schoolYearId, schoolYearId), isNull(assignments.endDate)))
    .limit(1);
  return !!row;
}



/* ────────────────────────────────────────────────────────────────────────── */
/* Application                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

export interface RosterRowResult {
  row:     number;
  status:  "created" | "assigned" | "skipped" | "error";
  name?:   string;
  email?:  string;
  reason?: string;
}

/** Walk an error's cause chain looking for a Postgres error code. */
function pgCode(e: unknown): string | null {
  if (typeof e !== "object" || e === null) return null;
  const obj = e as Record<string, unknown>;
  if (typeof obj["code"] === "string") return obj["code"];
  return obj["cause"] ? pgCode(obj["cause"]) : null;
}

function pgMessage(e: unknown): string | null {
  if (typeof e !== "object" || e === null) return null;
  const obj = e as Record<string, unknown>;
  if (typeof obj["detail"] === "string") return obj["detail"];
  if (typeof obj["message"] === "string") return obj["message"];
  return obj["cause"] ? pgMessage(obj["cause"]) : null;
}

/**
 * Execute a plan.
 *
 * Departures are NOT applied here. A roster upload only ever states who is
 * present; deactivating the people it omits happens at the activation flip, so
 * that staging next year's roster cannot disturb the year currently running.
 * For a live (non-staged) upload into the active year, departures are likewise
 * left alone — a mid-year hire import is not a statement that everyone missing
 * from it has resigned.
 */
export async function applyRosterPlan(plan: RosterPlan): Promise<RosterRowResult[]> {
  const results: RosterRowResult[] = plan.errors.map((e) => ({
    row: e.row, status: "error" as const, name: e.name, email: e.email, reason: e.reason,
  }));

  const today = new Date().toISOString().slice(0, 10);

  for (const action of plan.actions) {
    const p = action.parsed;
    try {
      if (action.kind === "create") {
        await db.transaction(async (tx) => {
          /*
           * A staged hire is created INERT: isActive false, so they cannot
           * sign in until the year they were hired for is activated.
           *
           * The person row has to exist now regardless, because
           * assignments.userId is a foreign key to people.employeeId and the
           * staged assignment cannot be written without it. isActive is what
           * keeps "nothing takes effect until the flip" true in practice.
           */
          await tx.insert(people).values({
            employeeId: p.employeeId,
            firstName:  p.firstName,
            lastName:   p.lastName,
            email:      p.email,
            role:       p.role,
            schoolId:   p.schoolId,
            isActive:   !plan.staged,
            includeInFeedbackTracker: p.includeInFeedbackTracker,
            department: p.department,
            gradeLevel: p.gradeLevel,
          });
          await tx.insert(assignments).values({
            userId:       p.employeeId,
            role:         p.role,
            schoolId:     p.schoolId,
            schoolYearId: plan.targetYearId,
            startDate:    today,
            endDate:      null,
          });
        });
        results.push({ row: p.row, status: "created", name: p.displayName, email: p.email });
        continue;
      }

      if (action.kind === "unchanged") {
        /* Identical open assignment already present. On a live upload the
           denormalised fields are still re-synced below, because a previous
           partial write can leave them stale and session lookups read them. */
        if (!plan.staged) await syncDenormalised(p);
        results.push({
          row: p.row, status: "skipped", name: p.displayName, email: p.email,
          reason: "Active assignment already exists with the same role and school",
        });
        continue;
      }

      /* kind === "assign" */
      await db.transaction(async (tx) => {
        if (action.existingAssignmentId !== null) {
          await tx.update(assignments)
            .set({ endDate: today })
            .where(eq(assignments.id, action.existingAssignmentId));
        }
        await tx.insert(assignments).values({
          userId:       p.employeeId,
          role:         p.role,
          schoolId:     p.schoolId,
          schoolYearId: plan.targetYearId,
          startDate:    today,
          endDate:      null,
        });
      });
      if (!plan.staged) await syncDenormalised(p);
      results.push({ row: p.row, status: "assigned", name: p.displayName, email: p.email });
    } catch (err: unknown) {
      const code    = pgCode(err);
      const message = pgMessage(err);
      console.error(`roster row ${p.row} DB error [${code}]:`, message, err);
      if (code === "23505") {
        results.push({
          row: p.row, status: "skipped", name: p.displayName, email: p.email,
          reason: "Duplicate email or employee ID",
        });
      } else {
        const hint = code ? `${code}: ${message ?? "unknown"}` : (message ?? "unknown database error");
        results.push({
          row: p.row, status: "error", name: p.displayName, email: p.email,
          reason: `Database error — ${hint}`,
        });
      }
    }
  }

  return results.sort((a, b) => a.row - b.row);
}

/**
 * Push a roster row's role/school onto the denormalised person record.
 * Only ever called for LIVE uploads — for a staged year the flip does this,
 * because changing these fields is immediately visible to school scoping.
 */
async function syncDenormalised(p: ParsedRosterRow): Promise<void> {
  await db.update(people)
    .set({ role: p.role, schoolId: p.schoolId })
    .where(and(
      eq(people.employeeId, p.employeeId),
      /* No-op guard: skip the write unless something would actually change.
         school_id is nullable, so it needs IS DISTINCT FROM — `<> 4` against
         NULL is NULL, not true, and a person with no school would never sync. */
      sql`(${people.role} <> ${p.role} OR ${people.schoolId} IS DISTINCT FROM ${p.schoolId})`,
    ));
}
