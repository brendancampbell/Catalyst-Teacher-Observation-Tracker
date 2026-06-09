import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { people, schools } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const SKIP_PATHS = [
  "/api/auth/impersonate",
  "/api/auth/stop-impersonating",
  "/api/auth/google",
  "/api/auth/logout",
];

export async function applyImpersonation(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.isAuthenticated() || !req.user) {
    return next();
  }

  const url = req.path;
  if (SKIP_PATHS.some((p) => url.startsWith(p))) {
    return next();
  }

  const impersonatingEmployeeId = req.session.impersonatingEmployeeId;
  if (!impersonatingEmployeeId) {
    return next();
  }

  try {
    const rows = await db
      .select({
        employeeId:               people.employeeId,
        firstName:                people.firstName,
        lastName:                 people.lastName,
        email:                    people.email,
        role:                     people.role,
        schoolId:                 people.schoolId,
        googleId:                 people.googleId,
        isActive:                 people.isActive,
        includeInFeedbackTracker: people.includeInFeedbackTracker,
        primaryInstructionalLeaderId: people.primaryInstructionalLeaderId,
        department:               people.department,
        gradeLevel:               people.gradeLevel,
        needsRescore:             people.needsRescore,
        rescoreDueDate:           people.rescoreDueDate,
        schoolName:               schools.name,
      })
      .from(people)
      .leftJoin(schools, eq(people.schoolId, schools.id))
      .where(eq(people.employeeId, impersonatingEmployeeId))
      .limit(1);

    if (rows.length > 0 && rows[0].isActive) {
      const target = rows[0];
      (req as Request & { realUser?: Express.User }).realUser = req.user;
      req.user = {
        employeeId:               target.employeeId,
        firstName:                target.firstName,
        lastName:                 target.lastName,
        name:                     `${target.firstName} ${target.lastName}`.trim(),
        email:                    target.email,
        role:                     target.role,
        schoolId:                 target.schoolId ?? null,
        googleId:                 target.googleId,
        isActive:                 target.isActive,
        includeInFeedbackTracker: target.includeInFeedbackTracker,
        primaryInstructionalLeaderId: target.primaryInstructionalLeaderId ?? null,
        department:               target.department ?? null,
        gradeLevel:               target.gradeLevel ?? null,
        needsRescore:             target.needsRescore,
        rescoreDueDate:           target.rescoreDueDate ?? null,
        schoolName:               target.schoolName ?? null,
      } as Express.User;
    } else {
      delete req.session.impersonatingEmployeeId;
      delete req.session.realEmployeeId;
    }
  } catch {
    /* on error, proceed as real user */
  }

  next();
}
