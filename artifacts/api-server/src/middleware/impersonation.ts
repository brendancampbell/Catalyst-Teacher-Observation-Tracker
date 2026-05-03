import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { users, schools } from "@workspace/db/schema";
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

  const impersonatingUserId = req.session.impersonatingUserId;
  if (!impersonatingUserId) {
    return next();
  }

  try {
    const rows = await db
      .select({
        id:         users.id,
        email:      users.email,
        name:       users.name,
        role:       users.role,
        schoolId:   users.schoolId,
        googleId:   users.googleId,
        isActive:   users.isActive,
        schoolName: schools.name,
      })
      .from(users)
      .leftJoin(schools, eq(users.schoolId, schools.id))
      .where(eq(users.id, impersonatingUserId))
      .limit(1);

    if (rows.length > 0 && rows[0].isActive) {
      const target = rows[0];
      (req as Request & { realUser?: Express.User }).realUser = req.user;
      req.user = {
        id:         target.id,
        email:      target.email,
        name:       target.name,
        role:       target.role,
        schoolId:   target.schoolId,
        googleId:   target.googleId,
        isActive:   target.isActive,
        schoolName: target.schoolName ?? null,
      } as Express.User;
    } else {
      delete req.session.impersonatingUserId;
      delete req.session.realUserId;
    }
  } catch {
    /* on error, proceed as real user */
  }

  next();
}
