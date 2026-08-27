import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Nothing may reach the observation endpoints except through saveObservation.
 *
 * The shared field list stops a screen forgetting a field it holds — that is a
 * compile error now. It cannot stop a NEW screen from calling the endpoints
 * directly and writing its own list again, which is exactly how the previous
 * fifteen copies came to exist. Nobody set out to duplicate anything; each was
 * added next to the one before it.
 *
 * So the rule is enforced here rather than left to memory. If this fails,
 * route the new call through `saveObservation` instead of adding a file to the
 * list below.
 *
 * The two edit paths are exempt deliberately. Correcting an observation is a
 * different shape — the few things that changed, sometimes a different teacher
 * — and was never part of the defect.
 */

const SRC = path.resolve(__dirname, "..");

const ALLOWED = new Set([
  "lib/api.ts",                          // the wrappers themselves
  "lib/observation-save.ts",             // the one way in
  "components/DrillDownModal.tsx",       // correcting, not composing
  "components/TeacherScoreOverlay.tsx",  // correcting, not composing
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
      `from @/lib/observation-save, which decides create-versus-update and sends the ` +
      `full field list:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("watches a list of files that all still exist", () => {
    /* A renamed exemption would silently stop protecting anything. */
    for (const rel of ALLOWED) {
      expect(() => statSync(path.join(SRC, rel)), `${rel} is exempted but missing`).not.toThrow();
    }
  });
});
