import express, { type Express } from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import passport from "passport";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { configurePassport } from "./lib/passport";
import { pool } from "@workspace/db";
import { applyImpersonation } from "./middleware/impersonation";
import { buildCsrfMiddleware } from "./middleware/csrf";
import { isProduction } from "./config/env";
import { isReady } from "./lib/readiness";

const PgStore = connectPgSimple(session);

configurePassport();

const app: Express = express();

app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

/* ── Readiness gate ──────────────────────────────────────────────────
   The port is bound before startup tasks finish so the deployment
   healthcheck succeeds immediately (see index.ts). Until those tasks
   complete they are running ALTER TABLE / CREATE INDEX / backfill UPDATE
   statements, so real requests must not be served against a database
   mid-migration. Health checks are exempt — answering them is the whole
   reason the port is bound early.

   Mounted before session/passport so a gated request never touches the
   database at all.                                                     */
const READINESS_EXEMPT_PATHS = new Set(["/api/healthz"]);

app.use((req, res, next) => {
  if (isReady() || READINESS_EXEMPT_PATHS.has(req.path)) {
    next();
    return;
  }
  res.setHeader("Retry-After", "5");
  res.status(503).json({
    error: "Server is still starting up. Please retry in a moment.",
    code:  "NOT_READY",
  });
});

/* ── CORS ────────────────────────────────────────────────────────────
   Exact-origin allowlist: REPLIT_DEV_DOMAIN + localhost only.
   No wildcard or regex — prevents suffix-domain spoofing.
   credentials:true is safe because origins are explicit strings.   */
const buildAllowedOrigins = (): string[] => {
  const origins: string[] = ["http://localhost:5173", "http://localhost:3000"];
  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  if (devDomain) {
    origins.push(`https://${devDomain}`);
  }
  const productionOrigin = process.env.GOOGLE_CALLBACK_URL
    ? new URL(process.env.GOOGLE_CALLBACK_URL).origin
    : null;
  if (productionOrigin) {
    origins.push(productionOrigin);
  }
  return origins;
};

const allowedOrigins = buildAllowedOrigins();

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret && isProduction) {
  throw new Error("SESSION_SECRET environment variable must be set in production");
}

app.use(
  session({
    store: new PgStore({
      pool,
      createTableIfMissing: false,
    }),
    secret: sessionSecret ?? "dev-secret-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isProduction,
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: isProduction ? "none" : "lax",
    },
  }),
);

app.use(passport.initialize());
app.use(passport.session());
app.use(buildCsrfMiddleware(allowedOrigins));
app.use(applyImpersonation);

/* ── Legacy redirect: /gbf-mobile/* → /catalyst-mobile/* ────────────────
   Preserves bookmarks from before the app was renamed. */
app.use("/gbf-mobile", (req, res) => {
  const rest = req.url; // e.g. "/" or "/some/path?q=1"
  res.redirect(301, `/catalyst-mobile${rest}`);
});

/* ── Smart redirect: /api/app → mobile or desktop based on User-Agent ──
   Must be registered BEFORE the /api router so auth middleware doesn't intercept it. */
const MOBILE_UA = /iPhone|iPod|BlackBerry|IEMobile|Opera Mini|(Android.*Mobile)/i;

app.get("/api/app", (req, res) => {
  const ua = req.headers["user-agent"] ?? "";
  const dest = MOBILE_UA.test(ua) ? "/catalyst-mobile/" : "/";
  res.redirect(302, dest);
});

app.use("/api", router);

export default app;
