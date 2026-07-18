import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { db } from "@workspace/db";
import { people, assignments } from "@workspace/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import type { Person } from "@workspace/db/schema";
import { getActiveSchoolYearId } from "./active-school-year";

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
      activeThisYear: boolean;
      includeInFeedbackTracker: boolean;
      schoolId: number | null;
      schoolName?: string | null;
      schoolAbbreviation?: string | null;
      department: string | null;
      gradeLevel: string[] | null;
      needsRescore: boolean;
      rescoreDueDate: string | null;
    }
  }
}

export async function checkActiveThisYear(employeeId: string): Promise<boolean> {
  const activeYearId = await getActiveSchoolYearId();
  /*
   * If no school year is marked active yet, do not block access — the system
   * may not yet have school years configured.
   */
  if (!activeYearId) return true;

  /*
   * Only enforce school-year scoping for users who have at least one assignment
   * row in the DB (indicating they went through the upload/onboarding flow at
   * some point). Brand-new accounts (e.g. just inserted via POST /api/people or
   * in integration test seed data) have no assignment rows at all — we treat
   * them as "not yet scoped" rather than "inactive" so they are not blocked.
   */
  const [anyAssignment] = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(eq(assignments.userId, employeeId))
    .limit(1);

  if (!anyAssignment) return true; /* no history at all — do not block */

  /* Has prior assignment history: require an open assignment in the active year */
  const [activeYearRow] = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(
      and(
        eq(assignments.userId, employeeId),
        eq(assignments.schoolYearId, activeYearId),
        isNull(assignments.endDate),
      ),
    )
    .limit(1);
  return !!activeYearRow;
}

function personToUser(
  person: Person & { school?: { displayName: string; abbreviation?: string | null } | null },
  activeThisYear: boolean,
): Express.User {
  return {
    employeeId:                  person.employeeId,
    firstName:                   person.firstName,
    lastName:                    person.lastName,
    name:                        `${person.firstName} ${person.lastName}`.trim(),
    email:                       person.email,
    googleId:                    person.googleId,
    role:                        person.role,
    isActive:                    person.isActive,
    activeThisYear,
    includeInFeedbackTracker:    person.includeInFeedbackTracker,
    schoolId:                    person.schoolId ?? null,
    schoolName:                  person.school?.displayName ?? null,
    schoolAbbreviation:          person.school?.abbreviation ?? null,
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
      { clientID, clientSecret, callbackURL, state: true },
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

          const activeThisYear = await checkActiveThisYear(person.employeeId);
          return done(null, personToUser({ ...person, googleId: profile.id }, activeThisYear));
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
      /* Re-enforce the same access gates applied at login time.
         A deactivated account or a role downgraded to NO_ACCESS must
         lose access immediately, not at cookie expiry (up to 7 days). */
      if (!person.isActive || person.role === "NO_ACCESS") return done(null, false);
      const activeThisYear = await checkActiveThisYear(person.employeeId);
      done(null, personToUser(person as Person & { school?: { displayName: string } | null }, activeThisYear));
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
