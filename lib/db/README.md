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
