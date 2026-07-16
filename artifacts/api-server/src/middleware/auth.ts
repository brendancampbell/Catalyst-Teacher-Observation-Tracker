import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { schools } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

export type UserRole = "COACH" | "SCHOOL_LEADER" | "NETWORK_LEADER" | "NETWORK_ADMIN" | "NO_ACCESS";

/* ── requireAuth ─────────────────────────────────────────────────
   Rejects unauthenticated requests with 401.
   Defence-in-depth: also explicitly blocks deactivated accounts and
   NO_ACCESS users so stale sessions that somehow survive
   deserializeUser cannot reach any protected route.                */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.isAuthenticated() && req.user) {
    const user = req.user as Express.User;
    if (!user.isActive || user.role === "NO_ACCESS") {
      req.logout(() => { /* best-effort session clear */ });
      res.status(403).json({ error: "Access denied" });
      return;
    }
    next();
    return;
  }
  res.status(401).json({ error: "Authentication required" });
}

/* ── requireRole ─────────────────────────────────────────────────
   Factory: require one of the specified roles.                     */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.isAuthenticated() || !req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!roles.includes((req.user as Express.User).role as UserRole)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}

/* ── requireNetworkScope ─────────────────────────────────────────
   Allow only NETWORK_LEADER and NETWORK_ADMIN.                     */
export const requireNetworkScope = requireRole("NETWORK_LEADER", "NETWORK_ADMIN");

/* ── requireNetworkAdmin ─────────────────────────────────────────
   Allow only NETWORK_ADMIN.                                         */
export const requireNetworkAdmin = requireRole("NETWORK_ADMIN");

/* ── requireSchoolLeaderOrAbove ──────────────────────────────────
   Allow SCHOOL_LEADER and above (not COACH).                       */
export const requireSchoolLeaderOrAbove = requireRole("SCHOOL_LEADER", "NETWORK_LEADER", "NETWORK_ADMIN");

/* ── NoSchoolAssignedError ────────────────────────────────────────
   Thrown by effectiveSchoolId when a school-scoped user has no
   schoolId configured. Route handlers should catch this and respond
   with 403 — never with 500 or with all-schools data.             */
export class NoSchoolAssignedError extends Error {
  constructor() {
    super("No school assigned to this user");
    this.name = "NoSchoolAssignedError";
  }
}

/* ── effectiveSchoolId ────────────────────────────────────────────
   Authoritative scoping rule for all data endpoints.
   - NO_ACCESS / inactive: always throws — should never reach here
     after requireAuth, but acts as a hard stop if called directly.
   - School-scoped users (COACH, SCHOOL_LEADER): always their own
     schoolId regardless of any requested value. Throws
     NoSchoolAssignedError if the user has no schoolId — never
     returns null for school-scoped roles (null means all schools).
   - Network-scoped users: use the requestedSchoolId when provided
     (viewing a specific school's tab); null means all schools.     */
export function effectiveSchoolId(
  user: Express.User,
  requestedSchoolId?: number | null,
): number | null {
  const role = user.role as UserRole;
  if (role === "NO_ACCESS" || !user.isActive) {
    throw new Error("Access denied");
  }
  if (role === "COACH" || role === "SCHOOL_LEADER") {
    if (!user.schoolId) throw new NoSchoolAssignedError();
    return user.schoolId;
  }
  return requestedSchoolId ?? null;
}

/* ── assertNetworkSchoolAccess ────────────────────────────────────
   For NETWORK_LEADER and NETWORK_ADMIN: verifies the requested
   schoolId is an active, non-archived school that belongs to the
   requesting user's network.
   "Same network" is derived from the region field:
     • If the user has no schoolId or is assigned to a home-office
       school they have organisation-wide access — any active school
       is permitted.
     • If the user is assigned to a non-home-office school their
       network is the region of that school; only schools in the
       same region are accessible.
   Returns a unified 403 for any denied school — never 404 or 422 —
   to prevent school-ID enumeration.
   For school-scoped roles (COACH, SCHOOL_LEADER) this is a no-op:
   effectiveSchoolId ignores any requested value and pins to the
   user's own school.                                               */
export async function assertNetworkSchoolAccess(
  user: Express.User,
  schoolId: number,
): Promise<{ ok: true } | { ok: false; status: 403; error: string }> {
  const role = user.role as UserRole;
  if (role !== "NETWORK_LEADER" && role !== "NETWORK_ADMIN") {
    return { ok: true };
  }

  /* Verify the requested school exists and is active */
  const [requestedSchool] = await db
    .select({
      id:         schools.id,
      isActive:   schools.isActive,
      isArchived: schools.isArchived,
      region:     schools.region,
    })
    .from(schools)
    .where(eq(schools.id, schoolId))
    .limit(1);

  if (!requestedSchool || !requestedSchool.isActive || requestedSchool.isArchived) {
    return { ok: false, status: 403, error: "School not found or not accessible" };
  }

  /* No school assigned → organisation-wide admin, allow any active school */
  if (!user.schoolId) {
    return { ok: true };
  }

  /* Derive the user's network region from their assigned school */
  const [userSchool] = await db
    .select({ region: schools.region, isHomeOffice: schools.isHomeOffice })
    .from(schools)
    .where(eq(schools.id, user.schoolId))
    .limit(1);

  if (!userSchool) {
    /* User's school no longer exists — treat as access denied */
    return { ok: false, status: 403, error: "School not found or not accessible" };
  }

  /* Home-office school → organisation-wide access, not region-restricted */
  if (userSchool.isHomeOffice) {
    return { ok: true };
  }

  /* Non-home-office assignment → restrict to the user's region */
  if (requestedSchool.region !== userSchool.region) {
    return { ok: false, status: 403, error: "School not found or not accessible" };
  }

  return { ok: true };
}

/* ── enforceSchoolScope ──────────────────────────────────────────
   For school-scoped users (COACH, SCHOOL_LEADER), inject their
   schoolId into req.query so downstream handlers automatically
   filter to the correct school.
   Defence-in-depth: also hard-stops NO_ACCESS / inactive users
   that somehow bypassed requireAuth.                               */
export function enforceSchoolScope(req: Request, res: Response, next: NextFunction): void {
  if (!req.isAuthenticated() || !req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const user = req.user as Express.User;
  const role: UserRole = user.role as UserRole;
  if (role === "NO_ACCESS" || !user.isActive) {
    req.logout(() => { /* best-effort session clear */ });
    res.status(403).json({ error: "Access denied" });
    return;
  }
  if (role === "COACH" || role === "SCHOOL_LEADER") {
    if (!user.schoolId) {
      res.status(403).json({ error: "No school assigned to this user" });
      return;
    }
    Object.assign(req.query, { schoolId: String(user.schoolId) });
  }
  next();
}
