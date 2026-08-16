#!/bin/bash
# check-migration-data-stmts.sh
#
# Fails if any migration file in lib/db/migrations/ contains DML statements
# without a required banner/annotation comment.
#
# Detection uses a SQL-aware Perl lexer that:
#   1. Recognises single-quoted, double-quoted, and dollar-quoted string
#      literals, and replaces their CONTENTS with empty placeholders so that
#      DML-looking text inside strings (e.g. 'UPDATE blurb') is never matched.
#   2. Strips line comments (-- ...) and block comments (/* ... */).
#   3. Splits on bare semicolons (outside strings/comments) so that each
#      logical statement is output on its own line.
#
# This approach shares the same logical model as the TypeScript guard
# (lib/db/src/check-migration-data-statements.ts), ensuring the two checks
# cannot diverge on what constitutes a "statement boundary" or "string content".
#
# DML forms detected (at statement boundaries):
#   UPDATE, INSERT INTO, DELETE FROM, MERGE, WITH (CTE preamble)
#
# Accepted markers (either is sufficient in the original source file):
#   -- ⚠️  ...          (the DATA BACKFILL banner)
#   -- MIGRATE-DATA: ... (the machine-readable annotation)
#
# See lib/db/README.md §Data backfills.
#
# Usage: bash scripts/check-migration-data-stmts.sh [migrations-dir]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATIONS_DIR="${1:-"$REPO_ROOT/lib/db/migrations"}"

# Write the SQL lexer to a temp file so shell quoting is trivial.
LEXER=$(mktemp /tmp/sql_lexer_XXXXXX.pl)
# shellcheck disable=SC2064
trap "rm -f '$LEXER'" EXIT

# The single-quoted heredoc marker ('PERL_EOF') prevents bash from expanding
# $variables, @ arrays, etc. inside the block.
cat > "$LEXER" << 'PERL_EOF'
use strict;
# SQL lexer for DML detection.
#
# Reads SQL from STDIN.  Outputs one logical SQL statement per output line.
# String literal CONTENTS are replaced with empty placeholders so that
# DML-looking text inside strings cannot cause false positives.
#
# Recognised quoting forms (only the delimiters are preserved; content is
# replaced with an empty placeholder):
#   'single-quoted strings'  (with '' escape)
#   "double-quoted identifiers"
#   $tag$dollar-quoted strings$tag$  (PostgreSQL)
#
# Recognised comment forms (replaced with a single space):
#   -- line comment
#   /* block comment */

my $src = do { local $/; <STDIN> };
my $pos = 0;
my $len = length($src);
my @stmts;
my $cur = "";

while ($pos < $len) {
    my $ch = substr($src, $pos, 1);

    # ── Single-quoted string ─────────────────────────────────────────────────
    # Parse the whole literal (including '' escapes and E-string backslash
    # escapes), discard the content, and emit just empty quotes so no DML
    # text leaks from string bodies.
    #
    # PostgreSQL escape-string literals (E'...' or e'...') allow backslash
    # escapes: \' is an embedded quote (NOT the end of the string), and \\
    # is a literal backslash.  We detect the E prefix in $cur and enter
    # backslash-aware mode so the string boundary is found correctly.
    if ($ch eq "'") {
        my $is_escape = ($cur =~ /[Ee]$/);    # E'...' or e'...'?
        $pos++;                                # skip opening quote
        while ($pos < $len) {
            my $c = substr($src, $pos, 1);
            $pos++;
            if ($is_escape && $c eq "\\") {
                $pos++;                        # skip backslash-escaped char (\' or \\)
            } elsif ($c eq "'") {
                if ($pos < $len && substr($src, $pos, 1) eq "'") {
                    $pos++;                    # skip '' escape
                } else { last; }              # end of string
            }
        }
        $cur =~ s/[Ee]$//;                    # remove E/e prefix already in $cur
        $cur .= "''";                          # emit empty placeholder
    }

    # ── Dollar-quoted string ─────────────────────────────────────────────────
    # Matches $tag$...$tag$ and $$...$$. Skip content entirely.
    elsif ($ch eq '$' && substr($src, $pos) =~ /^(\$[A-Za-z0-9_]*\$)/) {
        my $tag = $1;
        $pos += length($tag);                  # skip opening tag
        my $ep = index($src, $tag, $pos);
        if ($ep >= 0) {
            $pos = $ep + length($tag);         # skip to after closing tag
        } else {
            $pos = $len;                       # unclosed — consume rest
        }
        $cur .= "${tag}${tag}";               # emit empty placeholder, e.g. $$$$
    }

    # ── Double-quoted identifier ──────────────────────────────────────────────
    # Parse the whole identifier (including "" escapes), discard content.
    elsif ($ch eq '"') {
        $pos++;
        while ($pos < $len) {
            my $c = substr($src, $pos, 1);
            $pos++;
            if ($c eq '"') {
                if ($pos < $len && substr($src, $pos, 1) eq '"') {
                    $pos++;                    # skip "" escape
                } else { last; }
            }
        }
        $cur .= '""';                          # emit empty placeholder
    }

    # ── Line comment: -- rest of line ────────────────────────────────────────
    elsif ($ch eq '-' && $pos + 1 < $len && substr($src, $pos + 1, 1) eq '-') {
        while ($pos < $len && substr($src, $pos, 1) ne "\n") { $pos++; }
        $cur .= " ";
    }

    # ── Block comment: /* ... */ ──────────────────────────────────────────────
    elsif ($ch eq '/' && $pos + 1 < $len && substr($src, $pos + 1, 1) eq '*') {
        $pos += 2;
        while ($pos + 1 < $len) {
            if (substr($src, $pos, 2) eq '*/') { $pos += 2; last; }
            $pos++;
        }
        $cur .= " ";
    }

    # ── Statement separator: ; ────────────────────────────────────────────────
    elsif ($ch eq ';') {
        push @stmts, $cur;
        $cur = "";
        $pos++;
    }

    else { $cur .= $ch; $pos++; }
}

# Trailing statement without a terminating semicolon
push @stmts, $cur if $cur =~ /\S/;

# One statement per output line.  Because string contents have been replaced
# with empty single-line placeholders, each statement may still contain
# newlines from SQL formatting (e.g. multi-line WHERE clauses), but DML
# keywords from inside strings can no longer appear.
#
# We collapse internal newlines to spaces so that every STATEMENT is a
# single output line, keeping the grep below line-oriented and predictable.
for my $s (@stmts) {
    $s =~ s/\n/ /g;           # flatten SQL formatting newlines
    $s =~ s/\s+/ /g;          # normalise whitespace
    print "$s\n" if $s =~ /\S/;
}
PERL_EOF

FAIL=0

for sql_file in "$MIGRATIONS_DIR"/*.sql; do
    [ -f "$sql_file" ] || continue

    # Each output line is exactly one logical SQL statement, with string
    # literal contents replaced by empty placeholders and comments stripped.
    stripped=$(perl "$LEXER" < "$sql_file" 2>/dev/null)

    # Detect DML at statement boundaries.  Because the output is one statement
    # per line and string contents are blanked, this cannot match DML text
    # inside string literals.
    #
    # DO is included because PostgreSQL's DO block executes the dollar-quoted
    # body immediately; a DO block in a migration is effectively inline DML
    # and requires the same annotation as a bare UPDATE/INSERT/DELETE.
    if echo "$stripped" | grep -qiE '^\s*(UPDATE|INSERT\s+INTO|DELETE\s+FROM|MERGE|WITH|DO)\b'; then
        # Accept either marker in the original source file.
        if ! grep -qE '^\s*--.*⚠️|^\s*--\s*MIGRATE-DATA:' "$sql_file"; then
            echo "FAIL: $sql_file"
            echo "  Contains DML (UPDATE/INSERT/DELETE/MERGE/WITH-CTE) but is"
            echo "  missing the required banner/annotation comment."
            echo "  Add ONE of the following near the top of the file:"
            echo "    -- ⚠️  DATA BACKFILL — <short description>"
            echo "    -- MIGRATE-DATA: <what the DML does>"
            echo "  Then add/extend an idempotent ensure*() call in"
            echo "  artifacts/api-server/src/index.ts and update the table in"
            echo "  lib/db/README.md §Data backfills."
            FAIL=1
        fi
    fi
done

if [ "$FAIL" -eq 1 ]; then
    echo ""
    echo "check-migration-data-stmts: FAILED — see errors above"
    exit 1
fi

echo "check-migration-data-stmts: OK — all migration files with DML carry the required banner"
