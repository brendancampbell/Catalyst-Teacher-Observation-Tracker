/**
 * Login must not depend on Google OAuth being configured.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx --test src/test-passport-serializer-order.ts
 *
 * No database — it reads the source as text.
 *
 * configurePassport() bails out early when GOOGLE_CLIENT_ID / _SECRET are
 * absent, which is correct: there is no strategy to register. But the session
 * serializers used to sit AFTER that return, and they have nothing to do with
 * Google — they turn a user into an employee id for the cookie and back.
 *
 * With no credentials, passport was left with no serializer at all, so every
 * login failed with 500 "Failed to serialize user into session". dev-login
 * included, which is how the entire integration suite died on a machine that
 * had no OAuth credentials — 403 of 403 tests, all from this one line.
 *
 * Order is the whole fix, and order is invisible to the type checker, so it
 * is checked here as text rather than trusted to stay put.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here   = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, "lib", "passport.ts"), "utf8");

describe("configurePassport — session serializers", () => {
  const serialize   = source.indexOf("passport.serializeUser");
  const deserialize = source.indexOf("passport.deserializeUser");
  const googleGuard = source.indexOf("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set");

  test("all three landmarks are still there to compare", () => {
    assert.ok(serialize   > -1, "passport.serializeUser has gone missing");
    assert.ok(deserialize > -1, "passport.deserializeUser has gone missing");
    assert.ok(googleGuard > -1, "the Google-disabled warning has gone missing");
  });

  test("serializeUser is registered before the Google bail-out", () => {
    assert.ok(
      serialize < googleGuard,
      "serializeUser is registered after the early return for missing Google " +
      "credentials. Without OAuth configured passport has no serializer, and " +
      "every login — dev-login included — fails with a 500.",
    );
  });

  test("deserializeUser is too, or sessions cannot be read back", () => {
    assert.ok(
      deserialize < googleGuard,
      "deserializeUser is registered after the early return for missing " +
      "Google credentials, so an existing session cookie cannot be resolved.",
    );
  });
});
