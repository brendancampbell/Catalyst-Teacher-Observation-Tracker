import { Router } from "express";
import { db } from "@workspace/db";
import { people, schools } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

/**
 * POST /api/auth/dev-login
 *
 * Development-only endpoint that logs in as an existing person by employeeId
 * without requiring Google OAuth. Only available when NODE_ENV !== 'production'.
 *
 * Body: { employeeId: string }
 * Response: { ok: true, user: { employeeId, name, role } }
 */
router.post("/dev-login", async (req, res, next) => {
  if (process.env.NODE_ENV === "production") {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const { employeeId } = req.body as { employeeId?: unknown };
  if (typeof employeeId !== "string" || !employeeId.trim()) {
    res.status(400).json({ error: "employeeId (string) required" });
    return;
  }

  try {
    const person = await db.query.people.findFirst({
      where: eq(people.employeeId, employeeId.trim()),
      with: { school: true },
    });

    if (!person) {
      res.status(404).json({ error: "Person not found" });
      return;
    }
    if (!person.isActive) {
      res.status(403).json({ error: "Account deactivated" });
      return;
    }

    const user: Express.User = {
      employeeId:               person.employeeId,
      firstName:                person.firstName,
      lastName:                 person.lastName,
      name:                     `${person.firstName} ${person.lastName}`.trim(),
      email:                    person.email,
      googleId:                 person.googleId ?? null,
      role:                     person.role,
      isActive:                 person.isActive,
      includeInFeedbackTracker: person.includeInFeedbackTracker,
      schoolId:                 person.schoolId ?? null,
      schoolName:               (person.school as { displayName: string } | null)?.displayName ?? null,
      department:               person.department ?? null,
      gradeLevel:               person.gradeLevel ?? null,
      needsRescore:             person.needsRescore,
      rescoreDueDate:           person.rescoreDueDate ?? null,
    };

    req.logIn(user, (err) => {
      if (err) return next(err);
      res.json({ ok: true, user: { employeeId: user.employeeId, name: user.name, role: user.role } });
    });
  } catch (err) {
    console.error("POST /auth/dev-login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
