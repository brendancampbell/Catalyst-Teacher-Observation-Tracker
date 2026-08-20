/**
 * Unit tests for the schema-sync comparison helpers.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx --test src/test-schema-compare.ts
 *
 * No database needed — that is the point of keeping these pure. They guard the
 * riskiest part of check:schema-sync: deciding whether a declared type and a
 * live column type are the same thing. That check gates the production deploy,
 * so a false positive is worse than a missed drift — it teaches everyone to
 * ignore a red build.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  drizzleTypeToUdt,
  declaredLength,
  compareType,
  compareNullability,
  missingIndexes,
} from "@workspace/db/schema-compare";

describe("drizzleTypeToUdt", () => {
  test("maps every type this schema actually uses", () => {
    /* Taken from the live schema, not invented: these sixteen are the complete
       set of getSQLType() values across all Drizzle tables in lib/db. */
    assert.equal(drizzleTypeToUdt("serial"), "int4");
    assert.equal(drizzleTypeToUdt("integer"), "int4");
    assert.equal(drizzleTypeToUdt("text"), "text");
    assert.equal(drizzleTypeToUdt("boolean"), "bool");
    assert.equal(drizzleTypeToUdt("date"), "date");
    assert.equal(drizzleTypeToUdt("real"), "float4");
    assert.equal(drizzleTypeToUdt("jsonb"), "jsonb");
    assert.equal(drizzleTypeToUdt("timestamp with time zone"), "timestamptz");
  });

  test("prefixes arrays the way Postgres names them", () => {
    assert.equal(drizzleTypeToUdt("text[]"), "_text");
    assert.equal(drizzleTypeToUdt("integer[]"), "_int4");
  });

  test("treats a bare identifier as a user-defined type", () => {
    /* pgEnum reports its own type name, and information_schema reports
       udt_name identically, so they compare directly. */
    assert.equal(drizzleTypeToUdt("department_enum"), "department_enum");
    assert.equal(drizzleTypeToUdt("person_role"), "person_role");
    assert.equal(drizzleTypeToUdt("school_year_status"), "school_year_status");
  });

  test("drops a length qualifier from the base type", () => {
    assert.equal(drizzleTypeToUdt("varchar(50)"), "varchar");
    assert.equal(drizzleTypeToUdt("numeric(10, 2)"), "numeric");
  });

  test("is case- and whitespace-insensitive", () => {
    assert.equal(drizzleTypeToUdt("  TEXT  "), "text");
    assert.equal(drizzleTypeToUdt("Timestamp With Time Zone"), "timestamptz");
  });

  test("returns null rather than guessing", () => {
    /* The governing rule: anything unmappable is skipped, never reported as
       drift. A deploy gate that cries wolf gets deleted. */
    assert.equal(drizzleTypeToUdt(""), null);
    assert.equal(drizzleTypeToUdt("   "), null);
    assert.equal(drizzleTypeToUdt("some expression(a, b)"), null);
    assert.equal(drizzleTypeToUdt("Weird Type"), null);
  });
});

describe("declaredLength", () => {
  test("reads a length where there is one", () => {
    assert.equal(declaredLength("varchar(50)"), 50);
    assert.equal(declaredLength("char(3)"), 3);
  });
  test("returns null where there is none", () => {
    assert.equal(declaredLength("text"), null);
    assert.equal(declaredLength("numeric(10, 2)"), null);
  });
});

describe("compareType", () => {
  const db = (udtName: string, maxLength: number | null = null) =>
    ({ udtName, maxLength, nullable: false });

  test("accepts the same type described differently on each side", () => {
    assert.equal(compareType({ sqlType: "serial", notNull: true }, db("int4")).kind, "match");
    assert.equal(compareType({ sqlType: "timestamp with time zone", notNull: false }, db("timestamptz")).kind, "match");
    assert.equal(compareType({ sqlType: "text[]", notNull: false }, db("_text")).kind, "match");
    assert.equal(compareType({ sqlType: "department_enum", notNull: false }, db("department_enum")).kind, "match");
  });

  test("catches the drift that used to be invisible", () => {
    /* Declared text, stored varchar(50) — silent until the 51st character. */
    const v = compareType({ sqlType: "text", notNull: true }, db("varchar", 50));
    assert.equal(v.kind, "mismatch");
    assert.match(v.kind === "mismatch" ? v.actual : "", /varchar/);
  });

  test("catches a widened or narrowed length on the same base type", () => {
    const v = compareType({ sqlType: "varchar(50)", notNull: true }, db("varchar", 255));
    assert.equal(v.kind, "mismatch");
    assert.equal(v.kind === "mismatch" ? v.declared : "", "varchar(50)");
    assert.equal(v.kind === "mismatch" ? v.actual : "", "varchar(255)");
  });

  test("does not report drift it cannot be sure about", () => {
    const v = compareType({ sqlType: "some expression(a, b)", notNull: false }, db("text"));
    assert.equal(v.kind, "unknown");
  });

  test("does not invent a length mismatch when one side has none", () => {
    assert.equal(compareType({ sqlType: "varchar", notNull: false }, db("varchar", 50)).kind, "match");
    assert.equal(compareType({ sqlType: "varchar(50)", notNull: false }, db("varchar", null)).kind, "match");
  });
});

describe("compareNullability", () => {
  const db = (nullable: boolean) => ({ udtName: "text", maxLength: null, nullable });

  test("agrees when both sides agree", () => {
    assert.equal(compareNullability({ sqlType: "text", notNull: true }, db(false)).kind, "match");
    assert.equal(compareNullability({ sqlType: "text", notNull: false }, db(true)).kind, "match");
  });

  test("reports a column the schema thinks is required but the DB does not", () => {
    const v = compareNullability({ sqlType: "text", notNull: true }, db(true));
    assert.equal(v.kind, "mismatch");
    assert.equal(v.kind === "mismatch" ? v.declared : "", "NOT NULL");
    assert.equal(v.kind === "mismatch" ? v.actual : "", "nullable");
  });

  test("reports the reverse too", () => {
    const v = compareNullability({ sqlType: "text", notNull: false }, db(false));
    assert.equal(v.kind, "mismatch");
    assert.equal(v.kind === "mismatch" ? v.declared : "", "nullable");
  });
});

describe("missingIndexes", () => {
  test("reports a declared index the database does not have", () => {
    assert.deepEqual(
      missingIndexes(["people_school_idx", "school_years_single_active_uniq"], ["people_school_idx"]),
      ["school_years_single_active_uniq"],
    );
  });

  test("is silent when every declared index exists", () => {
    assert.deepEqual(missingIndexes(["a_idx", "b_idx"], ["a_idx", "b_idx", "c_idx"]), []);
  });

  test("ignores database indexes that are not declared", () => {
    /* Postgres creates its own for primary keys and unique constraints, and
       those never appear in Drizzle's index config. Reporting them would make
       a deploy gate noisy for no reason. */
    assert.deepEqual(missingIndexes([], ["people_pkey", "people_email_unique"]), []);
  });
});
