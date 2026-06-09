import type { Request, Response, NextFunction } from "express";

export type UserRole = "COACH" | "SCHOOL_LEADER" | "NETWORK_LEADER" | "NETWORK_ADMIN" | "NO_ACCESS";

/* ── requireAuth ─────────────────────────────────────────────────
   Rejects unauthenticated requests with 401.                       */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.isAuthenticated() && req.user) {
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
  if (role === "COACH" || role === "SCHOOL_LEADER") {
    if (!user.schoolId) throw new NoSchoolAssignedError();
    return user.schoolId;
  }
  return requestedSchoolId ?? null;
}

/* ── enforceSchoolScope ──────────────────────────────────────────
   For school-scoped users (COACH, SCHOOL_LEADER), inject their
   schoolId into req.query so downstream handlers automatically
   filter to the correct school.                                    */
export function enforceSchoolScope(req: Request, res: Response, next: NextFunction): void {
  if (!req.isAuthenticated() || !req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const user = req.user as Express.User;
  const role: UserRole = user.role as UserRole;
  if (role === "COACH" || role === "SCHOOL_LEADER") {
    if (!user.schoolId) {
      res.status(403).json({ error: "No school assigned to this user" });
      return;
    }
    Object.assign(req.query, { schoolId: String(user.schoolId) });
  }
  next();
}
