/**
 * Unit tests for the applyImpersonation middleware.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test:impersonation-middleware
 *
 * Uses the real @workspace/db import and monkey-patches db.select per scenario,
 * so no running server is required and no actual DB queries are made.
 *
 * Scenarios:
 *   1. DB error during identity query → HTTP 500 + session fields cleared
 *   2. Target employee not found (empty rows) → session cleared, next() called
 *   3. Target employee inactive → session cleared, next() called
 *   4. Target employee found and active → req.user replaced, next() called
 *   5. No impersonation session → passes through unchanged (no DB call)
 *   6. Unauthenticated request → passes through unchanged (no DB call)
 *   7. Skip-path (e.g. /api/auth/impersonate) → passes through unchanged (no DB call)
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { applyImpersonation } from "./middleware/impersonation.js";

/* ── Fluent chain factory ─────────────────────────────────────────────────── */

type ChainResult = () => Promise<unknown[]>;

function makeSelectChain(result: ChainResult) {
  const chain: Record<string, unknown> = {};
  const noop = () => chain;
  chain.from     = noop;
  chain.leftJoin = noop;
  chain.where    = noop;
  chain.limit    = result;
  return chain;
}

/* ── Mock req / res helpers ───────────────────────────────────────────────── */

type MockSession = Record<string, unknown>;

function makeSession(overrides: MockSession = {}): MockSession {
  return {
    impersonatingEmployeeId: "TARGET_001",
    realEmployeeId:          "ADMIN_001",
    ...overrides,
  };
}

function makeReq(opts: {
  authenticated?: boolean;
  path?: string;
  session?: MockSession;
  user?: Record<string, unknown>;
} = {}): Request {
  const session: MockSession = opts.session ?? makeSession();
  return {
    isAuthenticated: () => opts.authenticated ?? true,
    user:            opts.user ?? { employeeId: "ADMIN_001", role: "ADMIN" },
    path:            opts.path ?? "/api/observations/1",
    session,
  } as unknown as Request;
}

function makeRes(): Response & { _status: number | undefined; _body: unknown } {
  const res = {
    _status: undefined as number | undefined,
    _body:   undefined as unknown,
    status(code: number) { this._status = code; return this; },
    json(body: unknown) { this._body = body; return this; },
  };
  return res as unknown as Response & { _status: number | undefined; _body: unknown };
}

/* ── Patch / restore db.select ────────────────────────────────────────────── */

type SelectFn = typeof db.select;

let originalSelect: SelectFn;

function patchSelect(result: ChainResult) {
  (db as Record<string, unknown>).select = () => makeSelectChain(result);
}

function restoreSelect() {
  (db as Record<string, unknown>).select = originalSelect;
}

/* ── Test suite ───────────────────────────────────────────────────────────── */

describe("applyImpersonation middleware", () => {
  before(() => {
    originalSelect = db.select.bind(db);
  });

  after(() => {
    restoreSelect();
  });

  /* 1 ── DB error → HTTP 500 + session cleared ────────────────────────────── */

  it("1 — DB error returns HTTP 500 and clears session impersonation fields", async () => {
    patchSelect(async () => { throw new Error("simulated DB connection failure"); });

    const req  = makeReq();
    const res  = makeRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    await applyImpersonation(req, res, next);
    restoreSelect();

    assert.equal(res._status, 500, `Expected HTTP 500, got ${String(res._status)}`);
    assert.ok(!nextCalled, "next() must NOT be called after a DB error");
    assert.equal(
      req.session.impersonatingEmployeeId,
      undefined,
      "impersonatingEmployeeId must be deleted from session after DB error",
    );
    assert.equal(
      req.session.realEmployeeId,
      undefined,
      "realEmployeeId must be deleted from session after DB error",
    );
  });

  /* 2 ── Target not found (empty rows) → session cleared + next() ─────────── */

  it("2 — Target employee not found clears session and calls next()", async () => {
    patchSelect(async () => []);

    const req  = makeReq();
    const res  = makeRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    await applyImpersonation(req, res, next);
    restoreSelect();

    assert.equal(res._status, undefined, "Should not send any HTTP response");
    assert.ok(nextCalled, "next() must be called when target is not found");
    assert.equal(
      req.session.impersonatingEmployeeId,
      undefined,
      "impersonatingEmployeeId must be cleared when target is not found",
    );
    assert.equal(
      req.session.realEmployeeId,
      undefined,
      "realEmployeeId must be cleared when target is not found",
    );
  });

  /* 3 ── Target inactive → session cleared + next() ───────────────────────── */

  it("3 — Inactive target employee clears session and calls next()", async () => {
    patchSelect(async () => [{
      employeeId: "TARGET_001", firstName: "Jane", lastName: "Doe",
      email: "jane@example.com", role: "TEACHER", schoolId: 1,
      googleId: null, isActive: false, includeInFeedbackTracker: false,
      department: null, gradeLevel: null, needsRescore: false,
      rescoreDueDate: null, schoolName: "School One",
    }]);

    const req  = makeReq();
    const res  = makeRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    await applyImpersonation(req, res, next);
    restoreSelect();

    assert.equal(res._status, undefined, "Should not send any HTTP response");
    assert.ok(nextCalled, "next() must be called when target is inactive");
    assert.equal(
      req.session.impersonatingEmployeeId,
      undefined,
      "impersonatingEmployeeId must be cleared for inactive target",
    );
    assert.equal(
      req.session.realEmployeeId,
      undefined,
      "realEmployeeId must be cleared for inactive target",
    );
  });

  /* 4 ── Active target → req.user replaced + next() ───────────────────────── */

  it("4 — Active target employee swaps req.user and preserves realUser", async () => {
    patchSelect(async () => [{
      employeeId: "TARGET_001", firstName: "Jane", lastName: "Doe",
      email: "jane@example.com", role: "TEACHER", schoolId: 1,
      googleId: "gid-jane", isActive: true, includeInFeedbackTracker: true,
      department: "Math", gradeLevel: "9", needsRescore: false,
      rescoreDueDate: null, schoolName: "School One",
    }]);

    const req  = makeReq({ user: { employeeId: "ADMIN_001", role: "ADMIN" } });
    const res  = makeRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    await applyImpersonation(req, res, next);
    restoreSelect();

    assert.equal(res._status, undefined, "Should not send any HTTP response");
    assert.ok(nextCalled, "next() must be called on success");
    assert.equal(req.user.employeeId, "TARGET_001", "req.user.employeeId must be the target's");
    assert.equal(req.user.role, "TEACHER", "req.user.role must be the target's");
    assert.equal(
      (req as Request & { realUser?: Express.User }).realUser?.employeeId,
      "ADMIN_001",
      "req.realUser must preserve the original admin identity",
    );
  });

  /* 5 ── No impersonation session → passes through ────────────────────────── */

  it("5 — No impersonation session passes through without touching req.user", async () => {
    let selectCalled = false;
    patchSelect(async () => { selectCalled = true; return []; });

    const req  = makeReq({ session: {} });
    const res  = makeRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    await applyImpersonation(req, res, next);
    restoreSelect();

    assert.equal(res._status, undefined, "Should not send any HTTP response");
    assert.ok(nextCalled, "next() must be called");
    assert.ok(!selectCalled, "DB must not be queried when there is no impersonation session");
    assert.equal(req.user.employeeId, "ADMIN_001", "req.user must be unchanged");
  });

  /* 6 ── Unauthenticated request → passes through ─────────────────────────── */

  it("6 — Unauthenticated request passes through without a DB call", async () => {
    let selectCalled = false;
    patchSelect(async () => { selectCalled = true; return []; });

    const req  = makeReq({ authenticated: false, session: makeSession() });
    const res  = makeRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    await applyImpersonation(req, res, next);
    restoreSelect();

    assert.equal(res._status, undefined, "Should not send any HTTP response");
    assert.ok(nextCalled, "next() must be called");
    assert.ok(!selectCalled, "DB must not be queried for unauthenticated requests");
  });

  /* 7 ── Skip-path → passes through ──────────────────────────────────────── */

  it("7 — Skip-path (/api/auth/impersonate) passes through without a DB call", async () => {
    let selectCalled = false;
    patchSelect(async () => { selectCalled = true; return []; });

    const req  = makeReq({ path: "/api/auth/impersonate", session: makeSession() });
    const res  = makeRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    await applyImpersonation(req, res, next);
    restoreSelect();

    assert.equal(res._status, undefined, "Should not send any HTTP response");
    assert.ok(nextCalled, "next() must be called for skip paths");
    assert.ok(!selectCalled, "DB must not be queried for auth skip paths");
  });
});
