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
        schoolName: schools.name,
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
      .select({ id: users.id, email: users.email, name: users.name, role: users.role, schoolId: users.schoolId, schoolName: schools.name })
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
      .select({ id: users.id, email: users.email, name: users.name, role: users.role, schoolId: users.schoolId, schoolName: schools.name })
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

export default router;
