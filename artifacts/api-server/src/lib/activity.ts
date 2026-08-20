/**
 * Recording who uses Catalyst, and when.
 *
 * Nothing recorded a sign-in before this existed: no last_login column, no
 * audit table, and the `session` table belongs to connect-pg-simple — it holds
 * live sessions with an expiry, not a history. So this data can only ever
 * start accruing from the day it ships. That is why it was built before the
 * report that consumes it (backlog #20): the report can be written any time,
 * the history cannot be recovered.
 *
 * ── One row per person per day, not per authentication ────────────────────
 * Sessions last seven days and the cookie is not rolling, so someone who opens
 * Catalyst daily re-authenticates about four times a month. Counting OAuth
 * callbacks would report that person as barely using the tool. Counting active
 * days answers the question actually being asked.
 *
 * ── It must never break a request ─────────────────────────────────────────
 * The hook sits in deserializeUser, which runs on every authenticated request.
 * Telemetry that can 500 the app is worse than no telemetry, so every failure
 * here is logged and swallowed, and the write is fire-and-forget.
 */

import { db } from "@workspace/db";
import { userActivityDays } from "@workspace/db/schema";
import { sql } from "drizzle-orm";

/**
 * Today's date in Eastern time, as YYYY-MM-DD.
 *
 * Not UTC. Uncommon Schools is an East Coast network and evening work is
 * normal; with a UTC boundary a principal writing observations at 8pm would
 * have it filed as the next day, and "days active" would count a single
 * evening as two. en-CA is used because its date format is already ISO order.
 */
const ET_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year:     "numeric",
  month:    "2-digit",
  day:      "2-digit",
});

export function activityDateET(now: Date = new Date()): string {
  return ET_FORMATTER.format(now);
}

/**
 * Which (person, day) pairs this process has already written.
 *
 * The throttle is what keeps a per-request hook down to one write per person
 * per day. It is per-process and that is fine: with several instances the
 * worst case is a few extra upserts a day, and the unique index means they
 * collapse onto the same row either way.
 */
const written = new Map<string, string>();

/**
 * Whether to write, marking the pair as written when the answer is yes.
 *
 * A sign-in always writes, because it increments a counter — the throttle
 * exists to suppress repeat *activity* on a day already recorded, not to lose
 * authentications.
 */
export function claimWrite(employeeId: string, date: string, isSignIn: boolean): boolean {
  if (!isSignIn && written.get(employeeId) === date) return false;
  written.set(employeeId, date);
  return true;
}

/** Test seam: the throttle is process-global, so suites must be able to clear it. */
export function resetActivityThrottle(): void {
  written.clear();
}

/**
 * Record that this person used Catalyst today.
 *
 * Pass signIn when the call comes from an actual authentication, which also
 * increments that day's sign_in_count.
 */
export async function recordActivity(
  employeeId: string,
  opts: { signIn?: boolean } = {},
): Promise<void> {
  const isSignIn = opts.signIn === true;
  const date = activityDateET();
  if (!claimWrite(employeeId, date, isSignIn)) return;

  try {
    const insert = db
      .insert(userActivityDays)
      .values({
        employeeId,
        activityDate: date,
        signInCount:  isSignIn ? 1 : 0,
      });

    /*
     * Ordinary activity only needs the day to exist, so a conflict is the
     * answer already being correct — nothing to write. A sign-in has to
     * increment, and it does so in SQL rather than read-modify-write, so two
     * instances authenticating the same person at once cannot lose a count.
     */
    await (isSignIn
      ? insert.onConflictDoUpdate({
          target: [userActivityDays.employeeId, userActivityDays.activityDate],
          set:    { signInCount: sql`${userActivityDays.signInCount} + 1` },
        })
      : insert.onConflictDoNothing());
  } catch (err) {
    /* Swallowed on purpose — see the header. A failure here also drops this
       pair from the throttle so the next request retries rather than treating
       the day as recorded. */
    written.delete(employeeId);
    console.error("recordActivity failed for", employeeId, err);
  }
}
