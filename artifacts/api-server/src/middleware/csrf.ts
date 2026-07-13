import type { RequestHandler } from "express";
import { isProduction } from "../config/env";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF protection via Origin / Referer validation.
 *
 * For every state-changing request (POST, PUT, PATCH, DELETE) we verify that
 * the request originates from one of our explicitly-known frontend origins.
 * Browsers always attach an Origin header for cross-site requests; if it is
 * absent we fall back to the Referer header. If neither is present in
 * production the request is rejected, because our own JavaScript clients
 * always send Origin and a missing header is a strong signal of a crafted
 * request.
 *
 * This stops classic HTML-form CSRF: a hidden <form> on attacker.com will
 * carry the attacker's origin in Origin/Referer, which will not be in our
 * allowlist, so the server will reject it before any route handler runs.
 *
 * CORS does NOT stop this because CORS only governs cross-origin JavaScript
 * reads; plain form POSTs bypass it entirely.
 */
export function buildCsrfMiddleware(allowedOrigins: string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);

  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      return next();
    }

    const originHeader = req.headers["origin"];
    const refererHeader = req.headers["referer"];

    if (originHeader) {
      if (!allowed.has(originHeader)) {
        res.status(403).json({ error: "Forbidden: invalid request origin" });
        return;
      }
      return next();
    }

    if (refererHeader) {
      let refererOrigin: string;
      try {
        refererOrigin = new URL(refererHeader).origin;
      } catch {
        res.status(403).json({ error: "Forbidden: malformed Referer header" });
        return;
      }
      if (!allowed.has(refererOrigin)) {
        res.status(403).json({ error: "Forbidden: invalid request origin" });
        return;
      }
      return next();
    }

    if (isProduction) {
      res.status(403).json({ error: "Forbidden: missing Origin header" });
      return;
    }

    next();
  };
}
