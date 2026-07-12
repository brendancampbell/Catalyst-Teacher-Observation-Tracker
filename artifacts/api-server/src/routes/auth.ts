import { Router, type RequestHandler } from "express";
import passport from "passport";
import { db } from "@workspace/db";
import { people } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, requireNetworkAdmin } from "../middleware/auth";

const router = Router();

/**
 * Returns true only for safe same-origin relative paths.
 * Rejects protocol-relative URLs (//host/…), scheme URLs (http:, javascript:),
 * and anything that doesn't look like a clean app path.
 */
export function isSafeReturnTo(s: unknown): s is string {
  if (typeof s !== "string") return false;
  if (s.startsWith("//")) return false;   // protocol-relative absolute URL
  if (s.includes(":"))    return false;   // any scheme (http:, javascript:, …)
  return /^\/[A-Za-z0-9/_\-?=&#.%+]*$/.test(s);
}

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
    if (isSafeReturnTo(returnTo)) {
      req.session.returnTo = returnTo;
    }
    next();
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  passport.authenticate("google", { scope: ["profile", "email"], prompt: "select_account", state: true } as any),
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
      const isMobile = typeof returnTo === "string" && returnTo.startsWith("/catalyst-mobile");
      if (!user) {
        return res.redirect(isMobile ? "/catalyst-mobile/access-denied" : "/access-denied");
      }
      req.logIn(user, (loginErr) => {
        if (loginErr) return next(loginErr);
        delete req.session.returnTo;
        const dest = isSafeReturnTo(returnTo) ? returnTo : "/";
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
    _isImpersonating: !!req.session.impersonatingEmployeeId,
    _realUser: realUser
      ? { employeeId: realUser.employeeId, name: realUser.name }
      : null,
  });
});

/* ── POST /api/auth/impersonate ───────────────────────────────────
   Starts impersonating a person. Body: { employeeId: string }
   Only NETWORK_ADMIN can call this; cannot impersonate NETWORK_ADMIN. */
router.post("/impersonate", requireAuth, requireNetworkAdmin, async (req, res) => {
  const { employeeId } = req.body as { employeeId?: unknown };
  if (typeof employeeId !== "string" || !employeeId.trim()) {
    res.status(400).json({ error: "employeeId (string) required" });
    return;
  }

  const rows = await db
    .select({
      employeeId: people.employeeId,
      role:       people.role,
      firstName:  people.firstName,
      lastName:   people.lastName,
      isActive:   people.isActive,
    })
    .from(people)
    .where(eq(people.employeeId, employeeId.trim()))
    .limit(1);

  if (rows.length === 0) {
    res.status(404).json({ error: "Person not found" });
    return;
  }

  const target = rows[0];
  if (target.role === "NETWORK_ADMIN") {
    res.status(403).json({ error: "Cannot impersonate another Network Admin" });
    return;
  }
  if (!target.isActive) {
    res.status(403).json({ error: "Cannot impersonate a deactivated person" });
    return;
  }

  req.session.impersonatingEmployeeId = target.employeeId;
  req.session.realEmployeeId = (req.user as Express.User).employeeId;

  const name = `${target.firstName} ${target.lastName}`.trim();
  res.json({ ok: true, impersonating: { employeeId: target.employeeId, name } });
});

/* ── POST /api/auth/stop-impersonating ───────────────────────────
   Stops the active impersonation session.                          */
router.post("/stop-impersonating", requireAuth, (req, res) => {
  delete req.session.impersonatingEmployeeId;
  delete req.session.realEmployeeId;
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
