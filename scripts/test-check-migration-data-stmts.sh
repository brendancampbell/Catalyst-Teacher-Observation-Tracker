#!/bin/bash
# test-check-migration-data-stmts.sh
#
# Fixture-based tests for check-migration-data-stmts.sh.
# Verifies that the detector:
#   - FAILS on unbannered DML in conventional, same-line, block-comment-led,
#     and string-embedded-delimiter forms
#   - PASSES when a ⚠️ banner OR MIGRATE-DATA annotation is present
#   - Does NOT flag FK constraints like "ON UPDATE no action"
#   - Correctly handles SQL strings containing -- or ; characters
#
# Usage: bash scripts/test-check-migration-data-stmts.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK="$SCRIPT_DIR/check-migration-data-stmts.sh"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

PASS=0
FAIL=0

assert_exit() {
    local label="$1"
    local expected="$2"
    local dir="$3"
    local actual
    bash "$CHECK" "$dir" >/dev/null 2>&1 && actual=0 || actual=$?
    if [ "$actual" -eq "$expected" ]; then
        echo "  PASS: $label"
        PASS=$((PASS + 1))
    else
        echo "  FAIL: $label (expected exit $expected, got $actual)"
        FAIL=$((FAIL + 1))
    fi
}

# ── Negative cases: should FAIL (exit 1) ─────────────────────────────────────
echo "Negative cases (should be caught = exit 1):"

d="$WORKDIR/neg_update"; mkdir -p "$d"
cat > "$d/0001.sql" <<'SQL'
ALTER TABLE foo ADD COLUMN bar TEXT;
UPDATE foo SET bar = 'default' WHERE bar IS NULL;
SQL
assert_exit "plain UPDATE without banner" 1 "$d"

d="$WORKDIR/neg_insert"; mkdir -p "$d"
cat > "$d/0001.sql" <<'SQL'
INSERT INTO school_years (name, status) VALUES ('2024-25', 'active');
SQL
assert_exit "plain INSERT without banner" 1 "$d"

d="$WORKDIR/neg_delete"; mkdir -p "$d"
cat > "$d/0001.sql" <<'SQL'
DELETE FROM observation_scores
WHERE id NOT IN (SELECT MAX(id) FROM observation_scores GROUP BY obs_id);
SQL
assert_exit "plain DELETE without banner" 1 "$d"

d="$WORKDIR/neg_merge"; mkdir -p "$d"
cat > "$d/0001.sql" <<'SQL'
MERGE INTO target USING source ON (target.id = source.id)
  WHEN MATCHED THEN UPDATE SET col = source.col;
SQL
assert_exit "plain MERGE without banner" 1 "$d"

d="$WORKDIR/neg_cte"; mkdir -p "$d"
cat > "$d/0001.sql" <<'SQL'
WITH dupes AS (
  SELECT id FROM foo WHERE dup = true
)
DELETE FROM foo WHERE id IN (SELECT id FROM dupes);
SQL
assert_exit "CTE-led DELETE (WITH ... DELETE) without banner" 1 "$d"

d="$WORKDIR/neg_cte_update"; mkdir -p "$d"
cat > "$d/0001.sql" <<'SQL'
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS rn FROM school_years
)
UPDATE school_years SET display_order = rn
  FROM ranked WHERE school_years.id = ranked.id;
SQL
assert_exit "CTE-led UPDATE (WITH ... UPDATE) without banner" 1 "$d"

d="$WORKDIR/neg_same_line"; mkdir -p "$d"
cat > "$d/0001.sql" <<'SQL'
ALTER TABLE foo ADD COLUMN bar TEXT; UPDATE foo SET bar = 'x' WHERE bar IS NULL;
SQL
assert_exit "same-line post-semicolon DML without banner" 1 "$d"

d="$WORKDIR/neg_block_comment"; mkdir -p "$d"
cat > "$d/0001.sql" <<'SQL'
/* Backfill existing rows */ UPDATE foo SET bar = 1 WHERE bar IS NULL;
SQL
assert_exit "block-comment-prefixed UPDATE without banner" 1 "$d"

d="$WORKDIR/neg_quoted_dash"; mkdir -p "$d"
cat > "$d/0001.sql" <<'SQL'
SELECT '-- this is a string, not a comment'; UPDATE foo SET bar = 1;
SQL
assert_exit "UPDATE after string containing -- (no banner)" 1 "$d"

d="$WORKDIR/neg_quoted_semi"; mkdir -p "$d"
cat > "$d/0001.sql" <<'SQL'
INSERT INTO foo (note) VALUES ('a;b;c'); UPDATE foo SET x = 1;
SQL
assert_exit "DML after INSERT with ; inside string (no banner)" 1 "$d"

d="$WORKDIR/neg_dollar_quoted"; mkdir -p "$d"
cat > "$d/0001.sql" <<'SQL'
SELECT $body$-- not a real comment$body$; DELETE FROM foo WHERE id = 1;
SQL
assert_exit "DELETE after dollar-quoted string containing -- (no banner)" 1 "$d"

# ── Positive cases: should PASS (exit 0) ─────────────────────────────────────
echo "Positive cases (correctly annotated = exit 0):"

d="$WORKDIR/pos_banner"; mkdir -p "$d"
cat > "$d/0001.sql" <<'SQL'
-- ⚠️  DATA BACKFILL — sets bar on pre-existing rows; no startup mirror needed
ALTER TABLE foo ADD COLUMN bar TEXT;
UPDATE foo SET bar = 'default' WHERE bar IS NULL;
SQL
assert_exit "UPDATE with ⚠️ banner" 0 "$d"

d="$WORKDIR/pos_migrate_data"; mkdir -p "$d"
cat > "$d/0001.sql" <<'SQL'
-- MIGRATE-DATA: seeds school years; mirrored in ensureSchoolYears()
INSERT INTO school_years (name, status) VALUES ('2024-25', 'active');
SQL
assert_exit "INSERT with MIGRATE-DATA annotation" 0 "$d"

d="$WORKDIR/pos_cte"; mkdir -p "$d"
cat > "$d/0001.sql" <<'SQL'
-- ⚠️  MIXED DDL + DATA — CTE-led dedup before unique index
WITH dupes AS (
  SELECT id FROM foo WHERE dup = true
)
DELETE FROM foo WHERE id IN (SELECT id FROM dupes);
SQL
assert_exit "CTE-led DELETE with ⚠️ banner" 0 "$d"

d="$WORKDIR/pos_same_line"; mkdir -p "$d"
cat > "$d/0001.sql" <<'SQL'
-- ⚠️  DATA BACKFILL — inline update after DDL
ALTER TABLE foo ADD COLUMN bar TEXT; UPDATE foo SET bar = 'x' WHERE bar IS NULL;
SQL
assert_exit "same-line DML with ⚠️ banner" 0 "$d"

d="$WORKDIR/pos_block_comment"; mkdir -p "$d"
cat > "$d/0001.sql" <<'SQL'
-- MIGRATE-DATA: backfills bar column on existing rows
/* normalize existing rows */ UPDATE foo SET bar = 1 WHERE bar IS NULL;
SQL
assert_exit "block-comment-prefixed DML with MIGRATE-DATA annotation" 0 "$d"

d="$WORKDIR/pos_merge"; mkdir -p "$d"
cat > "$d/0001.sql" <<'SQL'
-- ⚠️  DATA BACKFILL — MERGE upserts seed data; mirrored in ensureFoo()
MERGE INTO target USING source ON (target.id = source.id)
  WHEN MATCHED THEN UPDATE SET col = source.col;
SQL
assert_exit "MERGE with ⚠️ banner" 0 "$d"

d="$WORKDIR/pos_quoted_dash"; mkdir -p "$d"
cat > "$d/0001.sql" <<'SQL'
-- ⚠️  DATA BACKFILL — sets note
SELECT '-- this is a string, not a comment'; UPDATE foo SET bar = 1;
SQL
assert_exit "UPDATE after string-embedded -- with ⚠️ banner" 0 "$d"

d="$WORKDIR/pos_quoted_semi"; mkdir -p "$d"
cat > "$d/0001.sql" <<'SQL'
-- MIGRATE-DATA: seeds rows with semicolons in values
INSERT INTO foo (note) VALUES ('a;b;c'); UPDATE foo SET x = 1;
SQL
assert_exit "DML with semicolons in string literal with MIGRATE-DATA" 0 "$d"

# ── False-positive guard: FK constraints must NOT trigger ─────────────────────
echo "False-positive guards (FK constraints must not trigger = exit 0):"

d="$WORKDIR/fk_only"; mkdir -p "$d"
cat > "$d/0001.sql" <<'SQL'
ALTER TABLE observations ADD CONSTRAINT obs_school_fk
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE restrict ON UPDATE no action;
ALTER TABLE action_steps ADD CONSTRAINT as_obs_fk
  FOREIGN KEY (observation_id) REFERENCES observations(id) ON DELETE set null ON UPDATE no action;
SQL
assert_exit "file with only FK ON UPDATE/ON DELETE (no DML)" 0 "$d"

d="$WORKDIR/select_only"; mkdir -p "$d"
cat > "$d/0001.sql" <<'SQL'
-- Schema-only file, no DML
CREATE TABLE foo (id serial PRIMARY KEY, name text NOT NULL);
ALTER TABLE foo ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
SQL
assert_exit "schema-only file has no false-positive on UPDATE in comment" 0 "$d"

# ── PostgreSQL E-string literals: backslash-escaped quotes must not confuse ────
# E'it\'s a test' uses \' as an embedded quote — the real string end is the
# SECOND unescaped '.  If the lexer terminates at \', it misses the trailing
# UPDATE and produces a false negative.
echo "E-string literals (backslash-escaped quotes must not confuse the lexer):"

d="$WORKDIR/estring_update_no_banner"; mkdir -p "$d"
cat > "$d/0001.sql" << 'SQL'
SELECT E'it\'s a test'; UPDATE foo SET bar = 1;
SQL
assert_exit "E-string with backslash-escaped quote, UPDATE after (no banner)" 1 "$d"

d="$WORKDIR/estring_insert_no_banner"; mkdir -p "$d"
cat > "$d/0001.sql" << 'SQL'
SELECT E'can\'t stop'; INSERT INTO foo (name) VALUES ('x');
SQL
assert_exit "E-string with backslash-escaped quote, INSERT after (no banner)" 1 "$d"

d="$WORKDIR/estring_dml_with_banner"; mkdir -p "$d"
cat > "$d/0001.sql" << 'SQL'
-- ⚠️  DATA BACKFILL — seeds foo after E-string SELECT
SELECT E'it\'s a test'; UPDATE foo SET bar = 1;
SQL
assert_exit "E-string with DML and ⚠️ banner (should pass)" 0 "$d"

d="$WORKDIR/estring_no_dml"; mkdir -p "$d"
cat > "$d/0001.sql" << 'SQL'
SELECT E'it\'s just a label' AS note, E'another\\escape' AS raw;
SQL
assert_exit "E-string with backslash escapes but no real DML (no false positive)" 0 "$d"

# ── DO blocks: executable PL/pgSQL blocks require annotation ─────────────────
# DO $$ ... $$ executes immediately during migration — the same as bare DML.
echo "DO blocks (executable PL/pgSQL = requires annotation):"

d="$WORKDIR/do_block_no_banner"; mkdir -p "$d"
cat > "$d/0001.sql" << 'SQL'
DO $$
BEGIN
  UPDATE foo SET bar = 'default' WHERE bar IS NULL;
END
$$;
SQL
assert_exit "DO block with UPDATE inside (no banner)" 1 "$d"

d="$WORKDIR/do_block_insert_no_banner"; mkdir -p "$d"
cat > "$d/0001.sql" << 'SQL'
DO $$
BEGIN
  INSERT INTO school_years (name, status) VALUES ('2024-25', 'active');
END
$$;
SQL
assert_exit "DO block with INSERT inside (no banner)" 1 "$d"

d="$WORKDIR/do_block_delete_no_banner"; mkdir -p "$d"
cat > "$d/0001.sql" << 'SQL'
DO $$
BEGIN
  DELETE FROM stale_sessions WHERE created_at < NOW() - INTERVAL '1 year';
END
$$;
SQL
assert_exit "DO block with DELETE inside (no banner)" 1 "$d"

d="$WORKDIR/do_block_with_banner"; mkdir -p "$d"
cat > "$d/0001.sql" << 'SQL'
-- ⚠️  DATA BACKFILL — idempotent upsert via DO block; mirrored in ensureFoo()
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM foo WHERE name = 'default') THEN
    INSERT INTO foo (name) VALUES ('default');
  END IF;
END
$$;
SQL
assert_exit "DO block with ⚠️ banner (should pass)" 0 "$d"

d="$WORKDIR/do_block_migrate_data"; mkdir -p "$d"
cat > "$d/0001.sql" << 'SQL'
-- MIGRATE-DATA: conditional insert via PL/pgSQL; mirrored in ensureSchoolYears()
DO $$
BEGIN
  UPDATE school_years SET status = 'inactive' WHERE status IS NULL;
END
$$;
SQL
assert_exit "DO block with MIGRATE-DATA annotation (should pass)" 0 "$d"

# ── Multiline string parity: DML inside string literals must NOT trigger ────────
# These cases verify that the shell and TypeScript guards agree: DML-like text
# that appears INSIDE a quoted string body is never treated as executable DML.
echo "Multiline string parity (DML inside strings must not trigger = exit 0):"

d="$WORKDIR/multiline_dollar_quoted"; mkdir -p "$d"
cat > "$d/0001.sql" << 'SQL'
SELECT $$
UPDATE documentation
SET content = 'example'
$$;
SQL
assert_exit "DML inside dollar-quoted string (no real DML)" 0 "$d"

d="$WORKDIR/multiline_single_quoted"; mkdir -p "$d"
cat > "$d/0001.sql" << 'SQL'
SELECT '
UPDATE nope
INSERT INTO nope VALUES (1)
DELETE FROM nope
';
SQL
assert_exit "DML inside single-quoted string (no real DML)" 0 "$d"

d="$WORKDIR/dollar_quoted_function"; mkdir -p "$d"
cat > "$d/0001.sql" << 'SQL'
CREATE OR REPLACE FUNCTION ensure_foo() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO school_years (name) VALUES ('2024-25');
  UPDATE school_years SET status = 'active' WHERE name = '2024-25';
END;
$$;
SQL
assert_exit "DML inside dollar-quoted function body (no real DML at statement level)" 0 "$d"

d="$WORKDIR/multiline_real_dml_with_banner"; mkdir -p "$d"
cat > "$d/0001.sql" << 'SQL'
-- ⚠️  DATA BACKFILL — seeds rows; mirrored in ensureFoo()
INSERT INTO school_years (name, status) VALUES ('2024-25', 'active');
UPDATE school_years SET display_order = 1 WHERE name = '2024-25';
SQL
assert_exit "real multiline DML with ⚠️ banner (should pass)" 0 "$d"

d="$WORKDIR/multiline_real_dml_no_banner"; mkdir -p "$d"
cat > "$d/0001.sql" << 'SQL'
INSERT INTO school_years (name, status)
  VALUES ('2024-25', 'active'),
         ('2025-26', 'inactive');
UPDATE school_years
  SET display_order = ROW_NUMBER() OVER (ORDER BY name);
SQL
assert_exit "real multiline DML without banner (should fail)" 1 "$d"

# ── Edge cases ─────────────────────────────────────────────────────────────────
echo "Edge cases:"

d="$WORKDIR/empty"; mkdir -p "$d"
assert_exit "empty directory (no .sql files)" 0 "$d"

d="$WORKDIR/schema_only"; mkdir -p "$d"
cat > "$d/0001.sql" <<'SQL'
CREATE TABLE foo (id serial PRIMARY KEY, name text NOT NULL);
ALTER TABLE foo ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
SQL
assert_exit "schema-only file (CREATE/ALTER, no DML)" 0 "$d"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
echo "All tests passed."
