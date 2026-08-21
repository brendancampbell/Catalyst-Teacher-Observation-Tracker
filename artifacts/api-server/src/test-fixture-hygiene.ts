/**
 * Fixture hygiene: no test may hardcode a school year id.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx --test src/test-fixture-hygiene.ts
 *
 * No database — it reads the suite as text.
 *
 * Fifteen fixtures across five files inserted rows with `schoolYearId: 1`.
 * That is only ever right by accident. It survived for months because none of
 * those tests read a year-scoped route, so nothing ever disagreed with it —
 * but the rows they wrote were invisible to anything that did, and after a
 * rollover the literal points at a year that has finished.
 *
 * The fix was mechanical. Keeping it fixed is not: the next fixture someone
 * writes will reach for a literal too, and the failure it causes will appear
 * somewhere else entirely, months later. So this checks the text instead of
 * trusting the habit.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* `schoolYearId:` followed by a bare number. Column alignment means the
   spacing varies, which is why a naive grep for "schoolYearId: 1" missed
   most of them. */
const HARDCODED = /schoolYearId:\s*\d+/g;

describe("test fixtures", () => {
  test("never hardcode a school year id", () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(dir).filter((f) => f.startsWith("test-") && f.endsWith(".ts"));
    assert.ok(files.length > 0, "found no test files — has this moved?");

    const offenders: string[] = [];
    for (const file of files) {
      /* This file quotes the pattern in its own comments. */
      if (file === "test-fixture-hygiene.ts") continue;
      const src = readFileSync(path.join(dir, file), "utf8");
      for (const m of src.matchAll(HARDCODED)) {
        const line = src.slice(0, m.index).split("\n").length;
        offenders.push(`${file}:${line}  ${m[0]}`);
      }
    }

    assert.deepEqual(
      offenders, [],
      "These fixtures pin a school year to a literal. Resolve the active year " +
      "instead:\n" +
      '  const [row] = await db.select({ id: schoolYears.id }).from(schoolYears)\n' +
      '    .where(eq(schoolYears.status, "active")).limit(1);\n\n' +
      offenders.map((o) => "  " + o).join("\n"),
    );
  });
});
