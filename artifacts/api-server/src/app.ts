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

const isProduction = process.env.NODE_ENV === "production";

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

app.use(
  cors({
    origin: buildAllowedOrigins(),
    credentials: true,
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

/* ── Smart redirect: /api/app → mobile or desktop based on User-Agent ──
   Must be registered BEFORE the /api router so auth middleware doesn't intercept it. */
const MOBILE_UA = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i;

app.get("/api/app", (req, res) => {
  const ua = req.headers["user-agent"] ?? "";
  const dest = MOBILE_UA.test(ua) ? "/gbf-mobile/" : "/";
  res.redirect(302, dest);
});

app.use("/api", router);

export default app;
