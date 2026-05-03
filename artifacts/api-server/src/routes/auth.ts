import { Router, type RequestHandler } from "express";
import passport from "passport";
import { db } from "@workspace/db";
import { users, schools } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireNetworkAdmin } from "../middleware/auth";

const router = Router();

const googleEnabled = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

const requireGoogleEnabled: RequestHandler = (_req, res, next) => {
  if (!googleEnabled) {
    res.status(503).json({ error: "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET." });
    return;
  }
  next();
};

/* ── GET /api/auth/google ─────────────────────────────────────────
   Redirect user to Google OAuth consent screen.
   Accepts optional ?returnTo=<url> to redirect after success.      */
router.get(
  "/google",
  requireGoogleEnabled,
  (req, res, next) => {
    const returnTo = req.query["returnTo"];
    if (typeof returnTo === "string" && /^\/[A-Za-z0-9/_\-?=&#.]*$/.test(returnTo)) {
      req.session.returnTo = returnTo;
    }
    next();
  },
  passport.authenticate("google", { scope: ["profile", "email"], prompt: "select_account" }),
);

/* ── GET /api/auth/google/callback ───────────────────────────────
   Google redirects here after consent. On success redirect to the
   returnTo path stored in session (or / by default); on failure
   redirect to /login?error=access_denied.                          */
router.get(
  "/google/callback",
  requireGoogleEnabled,
  (req, res, next) => {
    passport.authenticate("google", { session: true }, (err: unknown, user: Express.User | false) => {
      if (err) return next(err);
      const returnTo = req.session.returnTo;
      const isMobile = typeof returnTo === "string" && returnTo.startsWith("/gbf-mobile");
      if (!user) {
        return res.redirect(isMobile ? "/gbf-mobile/access-denied" : "/access-denied");
      }
      req.logIn(user, (loginErr) => {
        if (loginErr) return next(loginErr);
        delete req.session.returnTo;
        const dest = typeof returnTo === "string" && /^\/[A-Za-z0-9/_\-?=&#.]*$/.test(returnTo) ? returnTo : "/";
        res.redirect(dest);
      });
    })(req, res, next);
  },
);

/* ── GET /api/auth/me ─────────────────────────────────────────────
   Returns the currently effective user (impersonated if active)
   plus impersonation metadata.                                      */
router.get("/me", (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const realUser = (req as unknown as { realUser?: Express.User }).realUser;
  res.json({
    ...req.user,
    _isImpersonating: !!req.session.impersonatingUserId,
    _realUser: realUser ? { id: realUser.id, name: realUser.name } : null,
  });
});

/* ── POST /api/auth/impersonate ───────────────────────────────────
   Starts impersonating a user. Body: { userId: number }
   Only NETWORK_ADMIN can call this; cannot impersonate NETWORK_ADMIN. */
router.post("/impersonate", requireAuth, requireNetworkAdmin, async (req, res) => {
  const { userId } = req.body as { userId?: unknown };
  if (typeof userId !== "number") {
    res.status(400).json({ error: "userId (number) required" });
    return;
  }

  const rows = await db
    .select({
      id:       users.id,
      role:     users.role,
      name:     users.name,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (rows.length === 0) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const target = rows[0];
  if (target.role === "NETWORK_ADMIN") {
    res.status(403).json({ error: "Cannot impersonate another Network Admin" });
    return;
  }
  if (!target.isActive) {
    res.status(403).json({ error: "Cannot impersonate a deactivated user" });
    return;
  }

  req.session.impersonatingUserId = userId;
  req.session.realUserId = (req.user as Express.User).id;

  res.json({ ok: true, impersonating: { id: target.id, name: target.name } });
});

/* ── POST /api/auth/stop-impersonating ───────────────────────────
   Stops the active impersonation session.                          */
router.post("/stop-impersonating", requireAuth, (req, res) => {
  delete req.session.impersonatingUserId;
  delete req.session.realUserId;
  res.json({ ok: true });
});

/* ── POST /api/auth/logout ────────────────────────────────────────
   Destroys the session and redirects to /.                         */
router.post("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.redirect("/");
    });
  });
});

export default router;
