# @workspace/db

Drizzle ORM schema, migrations, and database utilities.

## Standard workflow

All schema changes must go through the tracked migration flow:

```sh
pnpm --filter @workspace/db run generate   # emit a new SQL migration file
pnpm --filter @workspace/db run migrate    # apply it via drizzle-kit migrate
```

`scripts/post-merge.sh` runs both steps automatically, wired up by the
`[postMerge]` hook in `.replit`. It fires **on merge** — i.e. when changes are
pulled into the Repl — not on deploy. That script is the only thing that
applies migrations; nothing in the deploy or boot path does.

It also runs `drizzle-kit generate` first, so a schema change that arrived
without a migration file gets one generated at merge time.

> **Note:** the hook has `timeoutMs = 35000`. That budget covers
> `pnpm install --frozen-lockfile`, two package builds, three backfill scripts,
> `generate`, the DML guards, `migrate`, a `tsc` build and `check:schema-sync`.
> If it overruns, the hook is cut short and migrations may not have been
> applied — with no obvious signal. Check the post-merge output after pulling
> a change that adds a migration, rather than assuming it ran.

## ⚠️ Do NOT use push or push-force on a tracked environment

`drizzle-kit push` (and the now-removed `push-force` variant) applies schema
changes directly to the database **without** writing a migration file. On any
environment where the `__drizzle_migrations` table is populated this will
**desync the tracker**: Drizzle will believe future migrations have already been
applied and skip them silently.

- **Development (fresh, empty DB):** `push` is acceptable as a quick local
  shortcut, but prefer `generate + migrate` to stay in sync with production.
- **Staging / Production / any tracked environment:** never run `push` or
  `push-force`. Use `generate + migrate` exclusively.
- **`push-force`** has been removed from `package.json` scripts. If you need
  to recover a broken local database, drop and recreate it instead of reaching
  for push-force.

## ⚠️ Data backfills in migration files

`drizzle-kit migrate` runs `.sql` migration files in order, so `UPDATE` /
`INSERT` statements inside them **do** execute — but only for environments that
use `migrate`.  Any environment initialised with `drizzle-kit push` (which
applies schema diffs directly without touching migration files) will silently
miss every data statement in every `.sql` file.

**Rule: every data backfill must have a matching `ensure*()` call in
`artifacts/api-server/src/index.ts` that is idempotent and runs on every
boot.**

| Migration file | Data statement | Startup mirror |
|---|---|---|
| `0001_add_school_years_and_assignments.sql` | `INSERT INTO school_years` | `ensureSchoolYears()` |
| `0002_rubric_sets_school_year.sql` | `UPDATE rubric_sets`, `UPDATE rubric_domains` | column-add backfill; new rows always supply school_year_id — no startup mirror needed |
| `0003_observations_action_steps_school_year.sql` | `UPDATE observations`, `UPDATE action_steps`, `UPDATE people` | column-add backfill; new rows always supply school_year_id — no startup mirror needed |
| `0004_school_years_display_order.sql` | `UPDATE school_years SET display_order` | `ensureSchoolYears()` — applies the same ROW_NUMBER() ordering when all rows have display_order = 0 and more than one row exists |
| `0005_schema_hardening.sql` | `DELETE FROM observation_scores` | one-time dedup before uniqueness index; app enforces ON CONFLICT DO UPDATE going forward — no startup mirror needed |
| `0006_school_number_not_null.sql` | `UPDATE schools SET school_number` | none — see "Schools are not seeded by code" below |

### ⚠️ Never edit an applied migration file

`drizzle-kit` identifies a migration by the SHA256 of its **file contents** and
records that hash in `drizzle.__drizzle_migrations`. Editing an applied
migration — including a comment — changes the hash, so Drizzle no longer
recognises it as applied and will try to re-run it.

This happened to `0006_school_number_not_null.sql`: its header comment was
rewritten to remove a reference to `ensureSchools()`, which orphaned its
tracking row and left the migration looking unapplied. Re-applying it would
have re-stamped `school_number` on all 52 schools, reverting any admin edit —
the exact class of bug that removing `ensureSchools()` was meant to stop.

The file has been restored byte-for-byte. **Its header comment is therefore
out of date**: it references `ensureSchools()` (removed) and states a rule
about mirroring backfills at startup (retired). Read it as history, and do not
"fix" it — the accurate description is the section below.

If a migration's documentation needs correcting, correct it here.

**How the startup guard treats this.** `drizzle-kit` decides what to apply by
timestamp, not by hash — it takes the newest applied row and runs anything with
a larger `folderMillis`. So an edited *old* migration can never be repaired by
running `migrate`. The guard in
`artifacts/api-server/src/lib/pending-migrations.ts` therefore separates:

| Case | Guard behaviour |
|---|---|
| Untracked, timestamp **newer** than the last applied row | **Blocks startup** — `migrate` will fix it |
| Untracked, timestamp **older** (an edited file) | **Logs and starts** — `migrate` cannot fix it, so blocking would deadlock |

A related trap: this journal's timestamps are **not monotonic** — `0005` and
`0006` carry `1753…` while `0000`–`0004` carry `1784…`. If either had never been
applied, `drizzle-kit migrate` would never apply it, because its timestamp is
below the newest applied row. Both are tracked today, so this is latent rather
than live, but keep it in mind before assuming `migrate` will pick up an old
migration.

### Schools are not seeded by code

Schools — including the Home Office pseudo-school — are created and edited
**exclusively through the admin UI**. Nothing in startup or deploy code inserts
or updates rows in the `schools` table.

This was not always true: `ensureSchools()` in `artifacts/api-server/src/index.ts`
used to re-seed 52 hardcoded schools on every boot with `ON CONFLICT DO UPDATE`,
which silently reverted any name, region, grade-span, or school-number edit an
admin made through `PATCH /api/admin/schools/:id`. That function has been
removed, along with the Home Office seed in `migrate.ts`.

Consequence: a brand-new database has **no schools at all**, and no Home Office
row. Because `NETWORK_LEADER` and `NETWORK_ADMIN` accounts must be assigned to a
Home Office school, the first admin has to create it through the Schools tab
(with the "is home office" flag set) before network-level users can be added.
Existing environments are unaffected — their rows are already in place.

`0006` is therefore an exception to the rule above: it is a historical one-time
backfill for environments that already had the 52 schools, and it deliberately
has no startup mirror.

When you write a new migration file that contains `INSERT` or `UPDATE`
statements:

1. Mark it with the `⚠️  DATA BACKFILL` banner (see `0006` for the template).
2. Add (or extend) an `ensure*()` function in `index.ts` that performs the
   same work idempotently.
3. Update the table above.
