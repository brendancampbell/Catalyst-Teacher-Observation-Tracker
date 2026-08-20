import { pgTable, serial, text, date, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { people } from "./people";

/**
 * One row per person per day they used Catalyst.
 *
 * ── Why days, and not sign-in events ──────────────────────────────────────
 * The obvious design is a row per authentication. It answers the wrong
 * question here. Sessions last seven days and the cookie is not rolling, so
 * somebody who opens Catalyst every single day re-authenticates roughly four
 * times a month. A "logins per user" report built on OAuth callbacks would
 * show that person as barely using the tool, which is the exact opposite of
 * what it is for.
 *
 * A row per active day answers what is actually being asked — who uses this,
 * how often, and who has never signed in at all — and it is bounded: at most
 * one row per person per day, so ~2000 staff over a 200-day school year is a
 * few hundred thousand rows at the absolute ceiling, and far fewer in
 * practice. No retention policy needed.
 *
 * sign_in_count keeps the raw authentication count too, since it costs one
 * integer and answers "how often are people being asked to sign in again".
 *
 * ── Deliberately not recorded ─────────────────────────────────────────────
 * Per-request timestamps. last_seen_at would have to be written on every
 * request to stay true, and the throttle exists precisely to avoid that. The
 * most recent activity is max(activity_date), accurate to the day, which is
 * the resolution this table honestly has.
 *
 * ── Impersonation ─────────────────────────────────────────────────────────
 * Activity is recorded in deserializeUser, which runs BEFORE
 * applyImpersonation swaps req.user. So an admin impersonating someone is
 * recorded as the admin, and the impersonated person is not credited with
 * activity they had no part in. That is a property of where the hook sits,
 * so moving it later would silently break it.
 */
export const userActivityDays = pgTable("user_activity_days", {
  id:           serial("id").primaryKey(),
  /* Cascade, matching every other "belongs to this person" table. Tests create
     and delete people constantly; a restricting FK here would turn their
     teardown into foreign key violations. */
  employeeId:   text("employee_id").notNull().references(() => people.employeeId, { onDelete: "cascade" }),
  /* The date in Eastern time, not UTC — see activityDateET() in the API
     server. Uncommon Schools is an East Coast network and evening work is
     normal; a UTC boundary would file 8pm as the next day. */
  activityDate: date("activity_date").notNull(),
  firstSeenAt:  timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  /* Actual authentications that day. 0 for a day spent on an existing session. */
  signInCount:  integer("sign_in_count").notNull().default(0),
}, (t) => [
  /* The upsert target, and the guarantee that "days active" is a row count. */
  uniqueIndex("user_activity_days_person_date_uniq").on(t.employeeId, t.activityDate),
  /* Reports are "activity between X and Y", so the date leads. */
  index("user_activity_days_date_idx").on(t.activityDate),
]);
