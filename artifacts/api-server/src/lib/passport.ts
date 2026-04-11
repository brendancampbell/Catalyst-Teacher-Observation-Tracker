import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { db } from "@workspace/db";
import { users } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import type { User } from "@workspace/db/schema";

declare global {
  namespace Express {
    interface User extends Omit<import("@workspace/db/schema").User, "googleId"> {
      googleId?: string | null;
      schoolName?: string | null;
    }
  }
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

          const user = await db.query.users.findFirst({
            where: eq(users.email, email),
            with: { school: true },
          });

          if (!user) {
            return done(null, false, { message: "Email not provisioned" });
          }

          if (!user.googleId) {
            await db
              .update(users)
              .set({ googleId: profile.id })
              .where(eq(users.id, user.id));
          }

          const userWithSchool = {
            ...user,
            googleId: profile.id,
            schoolName: (user as typeof user & { school?: { name: string } }).school?.name ?? null,
          };

          return done(null, userWithSchool);
        } catch (err) {
          return done(err as Error);
        }
      },
    ),
  );

  passport.serializeUser((user, done) => {
    done(null, (user as User).id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await db.query.users.findFirst({
        where: eq(users.id, id),
        with: { school: true },
      });
      if (!user) return done(null, false);
      done(null, {
        ...user,
        schoolName: (user as typeof user & { school?: { name: string } }).school?.name ?? null,
      });
    } catch (err) {
      done(err);
    }
  });
}

function buildCallbackURL(): string {
  const domain = process.env.REPLIT_DEV_DOMAIN;
  if (domain) {
    return `https://${domain}/api/auth/google/callback`;
  }
  const port = process.env.PORT ?? "3001";
  return `http://localhost:${port}/api/auth/google/callback`;
}
