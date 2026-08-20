/**
 * Unit tests for activity recording (backlog #21).
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx --test src/test-activity-recording.ts
 *
 * No database. The two things worth pinning here are the ones that would be
 * wrong silently for months: which day a timestamp is filed under, and whether
 * the throttle ever drops an authentication.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { activityDateET, claimWrite, resetActivityThrottle } from "./lib/activity.js";

describe("activityDateET", () => {
  test("files an evening in Eastern time under that same day", () => {
    /* The reason this is not UTC. 8pm ET is already tomorrow in UTC, so a
       principal writing observations after dinner would have the evening
       counted as a separate day of activity from the afternoon. */
    assert.equal(activityDateET(new Date("2026-03-10T20:30:00-04:00")), "2026-03-10");
    assert.equal(activityDateET(new Date("2026-03-10T23:59:00-04:00")), "2026-03-10");
  });

  test("rolls over at Eastern midnight, not UTC midnight", () => {
    assert.equal(activityDateET(new Date("2026-03-11T00:01:00-04:00")), "2026-03-11");
    /* Same instant, expressed in UTC: 04:01 on the 11th. */
    assert.equal(activityDateET(new Date("2026-03-11T04:01:00Z")), "2026-03-11");
    /* And 03:59 UTC is still the 10th in Eastern time. */
    assert.equal(activityDateET(new Date("2026-03-11T03:59:00Z")), "2026-03-10");
  });

  test("handles both sides of a daylight saving change", () => {
    /* US DST began 2026-03-08. Getting this wrong by an hour would misfile
       exactly one evening a year, which nobody would ever notice. */
    assert.equal(activityDateET(new Date("2026-03-07T23:00:00-05:00")), "2026-03-07");
    assert.equal(activityDateET(new Date("2026-03-09T23:00:00-04:00")), "2026-03-09");
  });

  test("always returns an ISO date, which is what a date column takes", () => {
    assert.match(activityDateET(new Date("2026-08-20T12:00:00Z")), /^\d{4}-\d{2}-\d{2}$/);
    assert.match(activityDateET(new Date("2026-01-05T12:00:00Z")), /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("claimWrite", () => {
  beforeEach(() => resetActivityThrottle());

  test("writes once per person per day for ordinary activity", () => {
    /* The whole point: this hook runs on every authenticated request. */
    assert.equal(claimWrite("U10", "2026-08-20", false), true);
    assert.equal(claimWrite("U10", "2026-08-20", false), false);
    assert.equal(claimWrite("U10", "2026-08-20", false), false);
  });

  test("writes again the next day", () => {
    assert.equal(claimWrite("U10", "2026-08-20", false), true);
    assert.equal(claimWrite("U10", "2026-08-21", false), true);
  });

  test("throttles each person independently", () => {
    assert.equal(claimWrite("U10", "2026-08-20", false), true);
    assert.equal(claimWrite("U13", "2026-08-20", false), true);
    assert.equal(claimWrite("U10", "2026-08-20", false), false);
  });

  test("never throttles an actual sign-in", () => {
    /* A sign-in increments a counter, so suppressing it loses data. The
       throttle exists to suppress repeat activity, not authentications. */
    assert.equal(claimWrite("U10", "2026-08-20", false), true);
    assert.equal(claimWrite("U10", "2026-08-20", true), true);
    assert.equal(claimWrite("U10", "2026-08-20", true), true);
  });

  test("a sign-in still marks the day, so activity after it is throttled", () => {
    assert.equal(claimWrite("U10", "2026-08-20", true), true);
    assert.equal(claimWrite("U10", "2026-08-20", false), false);
  });
});
