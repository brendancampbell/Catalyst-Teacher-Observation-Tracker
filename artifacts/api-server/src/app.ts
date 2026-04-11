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

app.use("/api", router);

export default app;
