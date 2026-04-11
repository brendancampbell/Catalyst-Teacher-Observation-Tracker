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
   Redirect user to Google OAuth consent screen.                    */
router.get(
  "/google",
  requireGoogleEnabled,
  passport.authenticate("google", { scope: ["profile", "email"], prompt: "select_account" }),
);

/* ── GET /api/auth/google/callback ───────────────────────────────
   Google redirects here after consent. On success redirect to the
   dashboard; on failure redirect to /login?error=access_denied.   */
router.get(
  "/google/callback",
  requireGoogleEnabled,
  passport.authenticate("google", {
    failureRedirect: "/login?auth_error=access_denied",
    session: true,
  }),
  (_req, res) => {
    res.redirect("/");
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
