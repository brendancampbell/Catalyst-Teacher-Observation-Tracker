import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { db } from "@workspace/db";
import { people } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import type { Person } from "@workspace/db/schema";

declare global {
  namespace Express {
    interface User {
      employeeId: string;
      firstName: string;
      lastName: string;
      name: string;
      email: string;
      googleId?: string | null;
      role: "COACH" | "SCHOOL_LEADER" | "NETWORK_LEADER" | "NETWORK_ADMIN" | "NO_ACCESS";
      isActive: boolean;
      includeInFeedbackTracker: boolean;
      schoolId: number | null;
      schoolName?: string | null;
      department: string | null;
      gradeLevel: string[] | null;
      needsRescore: boolean;
      rescoreDueDate: string | null;
    }
  }
}

function personToUser(person: Person & { school?: { name: string } | null }): Express.User {
  return {
    employeeId:                  person.employeeId,
    firstName:                   person.firstName,
    lastName:                    person.lastName,
    name:                        `${person.firstName} ${person.lastName}`.trim(),
    email:                       person.email,
    googleId:                    person.googleId,
    role:                        person.role,
    isActive:                    person.isActive,
    includeInFeedbackTracker:    person.includeInFeedbackTracker,
    schoolId:                    person.schoolId ?? null,
    schoolName:                  person.school?.name ?? null,
    department:                  person.department ?? null,
    gradeLevel:                  person.gradeLevel ?? null,
    needsRescore:                person.needsRescore,
    rescoreDueDate:              person.rescoreDueDate ?? null,
  };
}

export function configurePassport() {
  const clientID     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientID || !clientSecret) {
    console.warn(
      "[auth] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set — Google OAuth disabled. " +
      "Set these environment variables to enable login.",
    );
    return;
  }

  const callbackURL = buildCallbackURL();

  passport.use(
    new GoogleStrategy(
      { clientID, clientSecret, callbackURL },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) {
            return done(null, false, { message: "No email returned from Google" });
          }

          const person = await db.query.people.findFirst({
            where: eq(people.email, email.toLowerCase()),
            with: { school: true },
          });

          if (!person) {
            return done(null, false, { message: "Email not provisioned" });
          }

          if (!person.isActive) {
            return done(null, false, { message: "Account deactivated" });
          }

          if (person.role === "NO_ACCESS") {
            return done(null, false, { message: "You do not have access to this tool" });
          }

          if (!person.googleId) {
            await db
              .update(people)
              .set({ googleId: profile.id })
              .where(eq(people.employeeId, person.employeeId));
          }

          return done(null, personToUser({ ...person, googleId: profile.id }));
        } catch (err) {
          return done(err as Error);
        }
      },
    ),
  );

  passport.serializeUser((user, done) => {
    done(null, (user as Express.User).employeeId);
  });

  passport.deserializeUser(async (employeeId: string, done) => {
    try {
      const person = await db.query.people.findFirst({
        where: eq(people.employeeId, employeeId),
        with: { school: true },
      });
      if (!person) return done(null, false);
      done(null, personToUser(person as Person & { school?: { name: string } | null }));
    } catch (err) {
      done(err);
    }
  });
}

function buildCallbackURL(): string {
  if (process.env.GOOGLE_CALLBACK_URL) {
    return process.env.GOOGLE_CALLBACK_URL;
  }
  const domain = process.env.REPLIT_DEV_DOMAIN;
  if (domain) {
    return `https://${domain}/api/auth/google/callback`;
  }
  const port = process.env.PORT ?? "3001";
  return `http://localhost:${port}/api/auth/google/callback`;
}
