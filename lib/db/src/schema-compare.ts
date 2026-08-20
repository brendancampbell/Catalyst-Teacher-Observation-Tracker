/**
 * Pure comparison helpers for check-schema-sync.
 *
 * Separated from the check itself so the risky part — deciding whether a
 * declared type and a live column type are the same thing — can be tested
 * without a database.
 *
 * ── The governing rule: when unsure, say nothing ──────────────────────────
 * check:schema-sync gates the production deploy. A check that reports drift
 * it is not certain about trains everyone to ignore it, and the first instinct
 * on a red build becomes "delete the check". So every function here returns
 * `null` for anything it cannot map confidently, and the caller skips it.
 * A missed drift is recoverable; a false alarm on a deploy gate is not.
 */

/**
 * Canonical form of a type, using Postgres's own internal names — the same
 * values `information_schema.columns.udt_name` reports. That column is already
 * canonical (`int4`, `timestamptz`, `_text`, or the enum's own name), so the
 * database side needs no translation and only the Drizzle side is mapped.
 */
const DRIZZLE_TO_UDT: Record<string, string> = {
  /* integers — `serial` is an integer with a sequence default, not a type */
  "serial":                     "int4",
  "integer":                    "int4",
  "int":                        "int4",
  "bigserial":                  "int8",
  "bigint":                     "int8",
  "smallserial":                "int2",
  "smallint":                   "int2",

  /* floats and exact numerics */
  "real":                       "float4",
  "double precision":           "float8",
  "numeric":                    "numeric",
  "decimal":                    "numeric",

  /* text */
  "text":                       "text",
  "varchar":                    "varchar",
  "character varying":          "varchar",
  "char":                       "bpchar",
  "character":                  "bpchar",

  /* time */
  "timestamp with time zone":   "timestamptz",
  "timestamp":                  "timestamp",
  "timestamp without time zone": "timestamp",
  "date":                       "date",
  "time":                       "time",
  "time with time zone":        "timetz",

  /* everything else in use */
  "boolean":                    "bool",
  "bool":                       "bool",
  "json":                       "json",
  "jsonb":                      "jsonb",
  "uuid":                       "uuid",
};

/** A bare identifier — what a pgEnum's SQL type looks like. */
const BARE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * Turn a Drizzle `getSQLType()` string into the udt_name Postgres would report.
 *
 * Returns null when the type cannot be mapped confidently, which the caller
 * treats as "do not check this column" rather than as drift.
 *
 *   "serial"                   → "int4"
 *   "timestamp with time zone" → "timestamptz"
 *   "text[]"                   → "_text"      (Postgres prefixes arrays)
 *   "varchar(50)"              → "varchar"    (length compared separately)
 *   "department_enum"          → "department_enum"
 */
export function drizzleTypeToUdt(sqlType: string): string | null {
  const raw = sqlType.trim().toLowerCase();
  if (!raw) return null;

  /* Arrays: Postgres names them by prefixing the element type with "_". */
  if (raw.endsWith("[]")) {
    const element = drizzleTypeToUdt(raw.slice(0, -2));
    return element === null ? null : `_${element}`;
  }

  /* Drop a length or precision qualifier — varchar(50) is still a varchar.
     Length is compared on its own so a widened column is still reported. */
  const base = raw.replace(/\s*\([^)]*\)\s*$/, "").trim();

  const mapped = DRIZZLE_TO_UDT[base];
  if (mapped) return mapped;

  /*
   * Not a builtin we know. A pgEnum's SQL type is its own type name, and
   * Postgres reports those as data_type USER-DEFINED with udt_name set to
   * exactly that name — so a bare identifier can be compared directly.
   * Anything else (a composite, an expression) stays unmapped.
   */
  if (BARE_IDENTIFIER.test(base)) return base;

  return null;
}

/** The length in `varchar(50)`, or null when the type carries none. */
export function declaredLength(sqlType: string): number | null {
  const m = /\((\d+)\)\s*$/.exec(sqlType.trim());
  return m ? Number(m[1]) : null;
}

export interface DbColumn {
  /** information_schema.columns.udt_name — already canonical. */
  udtName: string;
  /** information_schema.columns.character_maximum_length. */
  maxLength: number | null;
  /** true when information_schema reports is_nullable = 'YES'. */
  nullable: boolean;
}

export interface DeclaredColumn {
  /** Drizzle's getSQLType(). */
  sqlType: string;
  /** notNull, or primary key — a primary key is never nullable. */
  notNull: boolean;
}

export type TypeVerdict =
  | { kind: "match" }
  /** Could not map the declared type; deliberately not treated as drift. */
  | { kind: "unknown"; declared: string }
  | { kind: "mismatch"; declared: string; actual: string };

/**
 * Compare a declared column type against the live one.
 *
 * Catches the drift that used to be invisible: a column declared `text` that
 * the database holds as `varchar(50)` reads identically to this check today,
 * right up until someone types a fifty-first character in production.
 */
export function compareType(declared: DeclaredColumn, actual: DbColumn): TypeVerdict {
  const wanted = drizzleTypeToUdt(declared.sqlType);
  if (wanted === null) return { kind: "unknown", declared: declared.sqlType };

  if (wanted !== actual.udtName) {
    return { kind: "mismatch", declared: `${declared.sqlType} (${wanted})`, actual: actual.udtName };
  }

  /* Same base type — a narrower or wider length is still a real difference. */
  const wantedLength = declaredLength(declared.sqlType);
  if (wantedLength !== null && actual.maxLength !== null && wantedLength !== actual.maxLength) {
    return {
      kind: "mismatch",
      declared: `${actual.udtName}(${wantedLength})`,
      actual: `${actual.udtName}(${actual.maxLength})`,
    };
  }

  return { kind: "match" };
}

/**
 * Whether nullability disagrees. Unlike types, this is never ambiguous: both
 * sides are booleans, so there is no "unknown" case to skip.
 */
export function compareNullability(
  declared: DeclaredColumn,
  actual: DbColumn,
): { kind: "match" } | { kind: "mismatch"; declared: string; actual: string } {
  const declaredNullable = !declared.notNull;
  if (declaredNullable === actual.nullable) return { kind: "match" };
  return {
    kind: "mismatch",
    declared: declaredNullable ? "nullable" : "NOT NULL",
    actual: actual.nullable ? "nullable" : "NOT NULL",
  };
}

/**
 * Declared indexes absent from the database.
 *
 * Deliberately ONE-DIRECTIONAL. Postgres creates its own indexes for primary
 * keys and unique constraints, and those never appear in Drizzle's index
 * config — so reporting database indexes that are undeclared would produce
 * constant noise on a check that gates deploys.
 */
export function missingIndexes(declared: string[], present: Iterable<string>): string[] {
  const have = new Set(present);
  return declared.filter((name) => !have.has(name));
}
