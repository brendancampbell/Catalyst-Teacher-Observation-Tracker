# @workspace/db

Drizzle ORM schema, migrations, and database utilities.

## Standard workflow

All schema changes must go through the tracked migration flow:

```sh
pnpm --filter @workspace/db run generate   # emit a new SQL migration file
pnpm --filter @workspace/db run migrate    # apply it via drizzle-kit migrate
```

`post-merge.sh` runs both steps automatically on every deploy.

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
| `0006_school_number_not_null.sql` | `UPDATE schools SET school_number` | `ensureSchools()` Step 7 (ON CONFLICT DO UPDATE) |

When you write a new migration file that contains `INSERT` or `UPDATE`
statements:

1. Mark it with the `⚠️  DATA BACKFILL` banner (see `0006` for the template).
2. Add (or extend) an `ensure*()` function in `index.ts` that performs the
   same work idempotently.
3. Update the table above.
