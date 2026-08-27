import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Nothing may reach the observation endpoints except through saveObservation.
 *
 * The mirror of the dashboard's guard, and the more important of the two:
 * mobile is where the walkthrough toggle could not be saved at all once a
 * draft existed, because all four of its save paths had been written out by
 * hand and every one of them had drifted.
 *
 * Mobile has no edit screen, so there are no exemptions beyond the wrappers
 * themselves. If this fails, route the new call through `saveObservation`.
 */

const SRC = path.resolve(__dirname, "..");

const ALLOWED = new Set([
  "lib/api.ts",
  "lib/observation-save.ts",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) return [];
    return [full];
  });
}

describe("saveObservation is the only way an observation is filed", () => {
  it("no other file calls the observation endpoints directly", () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => {
        const rel = path.relative(SRC, file).split(path.sep).join("/");
        if (ALLOWED.has(rel)) return false;
        return /\b(createObservation|updateObservation)\s*\(/.test(readFileSync(file, "utf8"));
      })
      .map((file) => path.relative(SRC, file).split(path.sep).join("/"));

    expect(
      offenders,
      `These call createObservation/updateObservation directly. Use saveObservation ` +
      `from @/lib/observation-save:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("does not post to the observation endpoint behind the wrappers' back", () => {
    /* Publishing on mobile used to bypass lib/api entirely with its own fetch,
       purely to read one field off the response — and that hand-written body
       was one of the paths that stopped sending the walkthrough toggle. */
    const offenders = sourceFiles(SRC)
      .filter((file) => path.relative(SRC, file).split(path.sep).join("/") !== "lib/api.ts")
      .filter((file) => /["'`]\/api\/observations/.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(SRC, file).split(path.sep).join("/"));

    expect(offenders, `Raw calls to /api/observations:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  it("watches a list of files that all still exist", () => {
    for (const rel of ALLOWED) {
      expect(() => statSync(path.join(SRC, rel)), `${rel} is exempted but missing`).not.toThrow();
    }
  });
});
