import { Router, type RequestHandler } from "express";
import passport from "passport";

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
      (req.session as Record<string, unknown>)["returnTo"] = returnTo;
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
  passport.authenticate("google", {
    failureRedirect: "/login?auth_error=access_denied",
    session: true,
  }),
  (req, res) => {
    const returnTo = (req.session as Record<string, unknown>)["returnTo"];
    delete (req.session as Record<string, unknown>)["returnTo"];
    const dest = typeof returnTo === "string" && /^\/[A-Za-z0-9/_\-?=&#.]*$/.test(returnTo) ? returnTo : "/";
    res.redirect(dest);
  },
);

/* ── GET /api/auth/me ─────────────────────────────────────────────
   Returns the currently authenticated user or 401.                 */
router.get("/me", (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json(req.user);
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
