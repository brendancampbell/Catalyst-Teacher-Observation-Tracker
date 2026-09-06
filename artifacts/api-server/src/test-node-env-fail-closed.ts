/**
 * Regression guard: the dev/production boundary must fail CLOSED.
 *
 * Every dangerous development affordance — the /api/auth/dev-login bypass
 * that logs anyone in as any employee, the seed routes, the plaintext
 * session cookie, the hardcoded session-secret fallback, and the
 * missing-Origin CSRF rejection — used to be gated on `!isProduction`.
 *
 * That is fail-OPEN. A deployment that lost NODE_ENV, or set it to "prod"
 * or "Production", would silently enable all of them at once, because
 * `!isProduction` is true for every value that is not exactly "production".
 *
 * They are now gated on `isDevelopment`, which is true only for exactly
 * "development". These tests pin that down.
 *
 * Child processes are used so each case gets a fresh module evaluation —
 * the flags are computed once at import time.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT  = path.resolve(__dirname, "..");

type Flags = {
  isProduction:  boolean;
  isDevelopment: boolean;
  isUnknownEnv:  boolean;
  nodeEnvLabel:  string;
};

/**
 * Evaluate config/env.ts in a child process under a given NODE_ENV.
 * Passing `undefined` deletes the variable rather than setting it empty.
 */
function flagsUnder(nodeEnv: string | undefined): Flags {
  const env = { ...process.env };
  if (nodeEnv === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = nodeEnv;

  const r = spawnSync(
    "pnpm",
    [
      "exec", "tsx", "-e",
      `import("./src/config/env.ts").then(m=>console.log(JSON.stringify({` +
      `isProduction:m.isProduction,isDevelopment:m.isDevelopment,` +
      `isUnknownEnv:m.isUnknownEnv,nodeEnvLabel:m.nodeEnvLabel})))`,
    ],
    { cwd: PKG_ROOT, env, encoding: "utf8", timeout: 60_000 },
  );

  assert.equal(r.status, 0, `child exited ${r.status}\nstderr: ${r.stderr}`);
  const line = (r.stdout as string).trim().split("\n").filter(Boolean).pop();
  assert.ok(line, `no stdout from child\nstderr: ${r.stderr}`);
  return JSON.parse(line) as Flags;
}

describe("NODE_ENV fail-closed boundary", () => {
  test("exactly \"production\" is production", () => {
    const f = flagsUnder("production");
    assert.equal(f.isProduction,  true);
    assert.equal(f.isDevelopment, false);
    assert.equal(f.isUnknownEnv,  false);
  });

  test("exactly \"development\" is development", () => {
    const f = flagsUnder("development");
    assert.equal(f.isProduction,  false);
    assert.equal(f.isDevelopment, true);
    assert.equal(f.isUnknownEnv,  false);
  });

  /* The regression this file exists for. */
  for (const value of [undefined, "", "prod", "Production", "PRODUCTION", "dev", "staging"]) {
    const label = value === undefined ? "unset" : `"${value}"`;
    test(`NODE_ENV ${label} does NOT enable development affordances`, () => {
      const f = flagsUnder(value);
      assert.equal(
        f.isDevelopment, false,
        `NODE_ENV ${label} must not count as development — dev-login would be exposed`,
      );
      assert.equal(f.isUnknownEnv, true, `NODE_ENV ${label} should be flagged as unknown`);
    });
  }

  test("an unset NODE_ENV is labelled for the startup warning", () => {
    assert.equal(flagsUnder(undefined).nodeEnvLabel, "(unset)");
  });
});

/* ── Source-level guard ──────────────────────────────────────────────────
   The runtime tests above only cover config/env.ts. These pin the call
   sites, so a future edit cannot reintroduce `!isProduction` as the gate
   on a dangerous affordance without failing the suite.                  */
describe("dangerous affordances are gated on isDevelopment, not !isProduction", () => {
  const FILES = [
    "routes/index.ts",     /* registers dev-login + dev-seed routers */
    "routes/dev-auth.ts",  /* the auth bypass itself */
    "routes/dev-seed.ts",  /* seed routes */
    "middleware/csrf.ts",  /* missing-Origin rejection */
    "app.ts",              /* session secret, cookie secure + sameSite */
  ];

  for (const rel of FILES) {
    test(`${rel} contains no "!isProduction" gate`, () => {
      const src = fs.readFileSync(path.join(__dirname, rel), "utf8");
      /* Strip block and line comments — the explanatory comments in these
         files legitimately mention !isProduction. */
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      assert.ok(
        !code.includes("!isProduction"),
        `${rel} gates on !isProduction, which is fail-open when NODE_ENV is ` +
        `unset or misspelled. Gate on isDevelopment instead.`,
      );
    });
  }
});
