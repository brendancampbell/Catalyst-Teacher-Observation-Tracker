import { Router } from "express";
import { db } from "@workspace/db";
import { users, schools } from "@workspace/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { requireRole, type UserRole } from "../middleware/auth";

const router = Router();

const SCHOOL_ASSIGNABLE_ROLES: UserRole[] = ["COACH", "SCHOOL_LEADER"];
const ALL_ROLES: UserRole[] = ["COACH", "SCHOOL_LEADER", "NETWORK_LEADER", "NETWORK_ADMIN"];

/* ── GET /api/users ───────────────────────────────────────────────
   SCHOOL_LEADER: own school only
   NETWORK_ADMIN: all users                                         */
router.get("/", requireRole("SCHOOL_LEADER", "NETWORK_ADMIN"), async (req, res) => {
  try {
    const currentUser = req.user as Express.User;
    const isNetworkAdmin = currentUser.role === "NETWORK_ADMIN";

    const rows = await db
      .select({
        id:         users.id,
        email:      users.email,
        name:       users.name,
        role:       users.role,
        schoolId:   users.schoolId,
        schoolName: schools.displayName,
        isActive:   users.isActive,
      })
      .from(users)
      .leftJoin(schools, eq(users.schoolId, schools.id))
      .where(
        isNetworkAdmin
          ? undefined
          : eq(users.schoolId, currentUser.schoolId!),
      )
      .orderBy(users.id);
    res.json(rows);
  } catch (err) {
    console.error("GET /users error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── POST /api/users ──────────────────────────────────────────────
   SCHOOL_LEADER: create Coach or School Leader in own school
   NETWORK_ADMIN: create any role in any school                     */
router.post("/", requireRole("SCHOOL_LEADER", "NETWORK_ADMIN"), async (req, res) => {
  try {
    const currentUser = req.user as Express.User;
    const isNetworkAdmin: boolean = currentUser.role === "NETWORK_ADMIN";
    const { email, name, role, schoolId } = req.body as {
      email: string;
      name: string;
      role: UserRole;
      schoolId?: number | null;
    };

    if (!email || !name || !role) {
      res.status(400).json({ error: "email, name, and role are required" });
      return;
    }

    if (!ALL_ROLES.includes(role)) {
      res.status(400).json({ error: `Invalid role: ${role}` });
      return;
    }

    if (!isNetworkAdmin) {
      if (!SCHOOL_ASSIGNABLE_ROLES.includes(role)) {
        res.status(403).json({ error: "School Leaders can only create Coach or School Leader users" });
        return;
      }
      if ((schoolId ?? currentUser.schoolId) !== currentUser.schoolId) {
        res.status(403).json({ error: "School Leaders can only create users in their own school" });
        return;
      }
    }

    const assignedSchoolId = isNetworkAdmin ? (schoolId ?? null) : currentUser.schoolId;

    const [created] = await db.insert(users).values({
      email: email.toLowerCase().trim(),
      name: name.trim(),
      role,
      schoolId: assignedSchoolId,
    }).returning();

    const [withSchool] = await db
      .select({ id: users.id, email: users.email, name: users.name, role: users.role, schoolId: users.schoolId, schoolName: schools.displayName, isActive: users.isActive })
      .from(users)
      .leftJoin(schools, eq(users.schoolId, schools.id))
      .where(eq(users.id, created.id));

    res.status(201).json(withSchool);
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && (err as { code?: unknown }).code === "23505") {
      res.status(409).json({ error: "A user with that email already exists" });
      return;
    }
    console.error("POST /users error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── POST /api/users/bulk ─────────────────────────────────────────
   NETWORK_ADMIN only: create many users from a JSON array.
   Returns per-row results: created | skipped | error.              */
router.post("/bulk", requireRole("NETWORK_ADMIN"), async (req, res) => {
  try {
    const rows = req.body as Array<{
      name?: unknown;
      email?: unknown;
      role?: unknown;
      school?: unknown;
    }>;

    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "Body must be a non-empty array of user objects" });
      return;
    }

    // Pre-fetch all schools once so we can do name→id resolution.
    const allSchools = await db
      .select({ id: schools.id, displayName: schools.displayName, fullName: schools.fullName })
      .from(schools);

    const schoolNameMap = new Map<string, number>();
    for (const s of allSchools) {
      const dn = s.displayName.toLowerCase().trim();
      if (!schoolNameMap.has(dn)) schoolNameMap.set(dn, s.id);
    }
    for (const s of allSchools) {
      if (s.fullName) schoolNameMap.set(s.fullName.toLowerCase().trim(), s.id);
    }
    const schoolIdSet = new Set<number>(allSchools.map((s) => s.id));

    const VALID_ROLES: UserRole[] = ["COACH", "SCHOOL_LEADER", "NETWORK_LEADER"];

    const results: Array<{
      row: number;
      status: "created" | "skipped" | "error";
      email?: string;
      name?: string;
      reason?: string;
    }> = [];

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];
      const rowNum = i + 1;

      const email  = typeof raw.email === "string" ? raw.email.trim().toLowerCase() : null;
      const name   = typeof raw.name  === "string" ? raw.name.trim()               : null;
      const role   = typeof raw.role  === "string" ? raw.role.trim().toUpperCase() : null;
      const school = typeof raw.school === "string" ? raw.school.trim()            : null;

      if (!email) {
        results.push({ row: rowNum, status: "error", reason: "Missing or invalid email" });
        continue;
      }
      if (!name) {
        results.push({ row: rowNum, status: "error", email, reason: "Missing name" });
        continue;
      }
      if (!role || !VALID_ROLES.includes(role as UserRole)) {
        results.push({ row: rowNum, status: "error", email, name, reason: `Invalid role "${raw.role}". Must be COACH, SCHOOL_LEADER, or NETWORK_LEADER` });
        continue;
      }

      // School is required for school-scoped roles (COACH, SCHOOL_LEADER)
      const SCHOOL_SCOPED_ROLES: UserRole[] = ["COACH", "SCHOOL_LEADER"];
      const needsSchool = SCHOOL_SCOPED_ROLES.includes(role as UserRole);

      // Resolve school → schoolId
      let schoolId: number | null = null;
      if (school) {
        const byName = schoolNameMap.get(school.toLowerCase());
        if (byName !== undefined) {
          schoolId = byName;
        } else {
          const asNum = Number(school);
          if (!isNaN(asNum) && schoolIdSet.has(asNum)) {
            schoolId = asNum;
          } else {
            results.push({ row: rowNum, status: "error", email, name, reason: `School "${school}" not found` });
            continue;
          }
        }
      } else if (needsSchool) {
        results.push({ row: rowNum, status: "error", email, name, reason: `School is required for role "${role}"` });
        continue;
      }

      try {
        await db.insert(users).values({
          email,
          name,
          role: role as UserRole,
          schoolId,
        });
        results.push({ row: rowNum, status: "created", email, name });
      } catch (err: unknown) {
        const isDuplicate = (e: unknown): boolean => {
          if (typeof e !== "object" || e === null) return false;
          const obj = e as Record<string, unknown>;
          if (obj["code"] === "23505") return true;
          if (obj["cause"] && isDuplicate(obj["cause"])) return true;
          return false;
        };
        if (isDuplicate(err)) {
          results.push({ row: rowNum, status: "skipped", email, name, reason: "Duplicate email" });
        } else {
          results.push({ row: rowNum, status: "error", email, name, reason: "Database error" });
        }
      }
    }

    res.json({ results });
  } catch (err) {
    console.error("POST /users/bulk error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── PATCH /api/users/:id ─────────────────────────────────────────
   SCHOOL_LEADER: update Coach or School Leader in own school
   NETWORK_ADMIN: update any user with any role                     */
router.patch("/:id", requireRole("SCHOOL_LEADER", "NETWORK_ADMIN"), async (req, res) => {
  try {
    const currentUser = req.user as Express.User;
    const isNetworkAdmin: boolean = currentUser.role === "NETWORK_ADMIN";
    const userId = Number(req.params.id);
    const { email, name, role, schoolId } = req.body as {
      email?: string;
      name?: string;
      role?: UserRole;
      schoolId?: number | null;
    };

    const target = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (!isNetworkAdmin) {
      if (target.schoolId !== currentUser.schoolId) {
        res.status(403).json({ error: "Cannot edit users in another school" });
        return;
      }
      if (role && !SCHOOL_ASSIGNABLE_ROLES.includes(role)) {
        res.status(403).json({ error: "School Leaders can only assign Coach or School Leader roles" });
        return;
      }
      if (!SCHOOL_ASSIGNABLE_ROLES.includes(target.role as UserRole)) {
        res.status(403).json({ error: "Cannot edit Network Leader or Network Admin users" });
        return;
      }
    }

    const updates: {
      email?: string;
      name?: string;
      role?: UserRole;
      schoolId?: number | null;
    } = {};
    if (email)    updates.email    = email.toLowerCase().trim();
    if (name)     updates.name     = name.trim();
    if (role)     updates.role     = role;
    if (schoolId !== undefined && isNetworkAdmin) updates.schoolId = schoolId;

    const [updated] = await db.update(users).set(updates).where(eq(users.id, userId)).returning();

    const [withSchool] = await db
      .select({ id: users.id, email: users.email, name: users.name, role: users.role, schoolId: users.schoolId, schoolName: schools.displayName, isActive: users.isActive })
      .from(users)
      .leftJoin(schools, eq(users.schoolId, schools.id))
      .where(eq(users.id, updated.id));

    res.json(withSchool);
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && (err as { code?: unknown }).code === "23505") {
      res.status(409).json({ error: "A user with that email already exists" });
      return;
    }
    console.error("PATCH /users/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── PATCH /api/users/:id/toggle-active ───────────────────────────
   Soft-delete: flip isActive. Same scope rules as PATCH /:id.
   Cannot deactivate yourself.                                       */
router.patch("/:id/toggle-active", requireRole("SCHOOL_LEADER", "NETWORK_ADMIN"), async (req, res) => {
  try {
    const currentUser = req.user as Express.User;
    const isNetworkAdmin: boolean = currentUser.role === "NETWORK_ADMIN";
    const userId = Number(req.params.id);

    if (userId === currentUser.id) {
      res.status(400).json({ error: "You cannot deactivate your own account" });
      return;
    }

    const target = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (!isNetworkAdmin) {
      if (target.schoolId !== currentUser.schoolId) {
        res.status(403).json({ error: "Cannot edit users in another school" });
        return;
      }
      if (!SCHOOL_ASSIGNABLE_ROLES.includes(target.role as UserRole)) {
        res.status(403).json({ error: "Cannot edit Network Leader or Network Admin users" });
        return;
      }
    }

    const [updated] = await db
      .update(users)
      .set({ isActive: !target.isActive })
      .where(eq(users.id, userId))
      .returning();

    const [withSchool] = await db
      .select({ id: users.id, email: users.email, name: users.name, role: users.role, schoolId: users.schoolId, schoolName: schools.displayName, isActive: users.isActive })
      .from(users)
      .leftJoin(schools, eq(users.schoolId, schools.id))
      .where(eq(users.id, updated.id));

    res.json(withSchool);
  } catch (err) {
    console.error("PATCH /users/:id/toggle-active error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
