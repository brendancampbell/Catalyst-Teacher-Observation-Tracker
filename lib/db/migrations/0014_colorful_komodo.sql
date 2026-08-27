-- Adds SpEd to the department list, before Other so Other stays last.
--
-- ALTER TYPE ... ADD VALUE runs inside a transaction on Postgres 12 and later
-- provided the new value is not USED in the same transaction. Nothing here
-- uses it, so this is safe under drizzle-kit's per-migration transaction.
--
-- IF NOT EXISTS so a retried deploy cannot fail on a value that is already
-- there. The tracking table should prevent a re-run, but a migration that adds
-- a name is worth making idempotent anyway.
ALTER TYPE "public"."department_enum" ADD VALUE IF NOT EXISTS 'SpEd' BEFORE 'Other';
