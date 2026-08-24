# Not a migrations directory

Nothing in here runs automatically. The real migrations live in `lib/db/migrations`,
which is what `drizzle.config.ts` points at and what `drizzle-kit migrate` reads.
These files have only ever run where somebody ran them by hand.

That gap caused a live bug. `0005_assignments_school_year.sql` drops
`assignments_user_active_uniq` — an index migration 0001 creates that allows a
person one open assignment across all years, which makes a staged rollover
impossible. Because this file is not in the drizzle journal, the drop never ran on
any database built from the migrations; it reached development and production only
by hand. It surfaced on 2026-08-21, when the test suite first built a database from
empty and every staged-roster copy silently wrote zero rows.
`lib/db/migrations/0012_drop_stale_assignment_index.sql` now does it properly.

If you need a schema change, generate it into `lib/db/migrations`:

    pnpm --filter @workspace/db exec drizzle-kit generate

`seed-assignments.ts` is a one-off backfill script kept for reference. Its header
has the command to run it.
