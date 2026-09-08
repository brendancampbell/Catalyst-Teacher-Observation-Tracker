/**
 * The grid places a school in a column and that placement reads as a fact —
 * "this school needs somebody this week". A school in the wrong column does
 * not look broken, it looks true, so the banding is tested on its own rather
 * than through the screen.
 */
import { describe, it, expect } from "vitest";
import type { CategoryEntry, DistrictSchoolRow } from "@workspace/api-types";
import { bandFor, scoreForLens, buildBandMatrix, lensOptionsFor } from "@/lib/proficiencyBands";

const school = (
  name: string,
  region: string,
  overall: number | null,
  domainAverages: Record<string, number | null> = {},
): DistrictSchoolRow => ({
  id: name.length + name.charCodeAt(0),
  name,
  abbreviation: name.slice(0, 3).toUpperCase(),
  region,
  gradeSpan: "K-8",
  teacherCount: 10,
  observedCount: 5,
  domainAverages,
  overall,
  lastObservedDate: null,
});

const categories: CategoryEntry[] = [
  { id: "c1", label: "Instruction", domains: [{ id: "d1", label: "Pacing" }, { id: "d2", label: "Checks" }] },
  { id: "c2", label: "Culture",     domains: [{ id: "d3", label: "Routines" }] },
];

describe("bandFor", () => {
  it("puts 0.7 in Proficient and 0.5 in Working Towards — the lines are inclusive", () => {
    expect(bandFor(0.7)).toBe("proficient");
    expect(bandFor(0.5)).toBe("working");
  });

  it("separates the two schools the old single line treated alike", () => {
    expect(bandFor(0.68)).toBe("working");
    expect(bandFor(0.3)).toBe("needs");
  });

  it("calls a school with no score unscored rather than zero", () => {
    expect(bandFor(null)).toBe("unscored");
    expect(bandFor(0)).toBe("needs");
  });

  /* 0.6951 prints as "0.70" in the cell. Banding the raw value would file it
     under Working Towards and the number on screen would contradict the
     column it sat in. */
  it("bands on the two decimals the grid prints, not the raw value", () => {
    expect((0.6951).toFixed(2)).toBe("0.70");
    expect(bandFor(0.6951)).toBe("proficient");
    expect(bandFor(0.4951)).toBe("working");
  });
});

describe("scoreForLens", () => {
  const s = school("Alpha", "NYC", 0.8, { d1: 0.9, d2: 0.3, d3: null });

  it("uses the school's own overall for the whole rubric", () => {
    expect(scoreForLens(s, { kind: "overall" }, categories)).toBe(0.8);
  });

  it("reads one domain straight off the school", () => {
    expect(scoreForLens(s, { kind: "domain", id: "d2" }, categories)).toBe(0.3);
  });

  it("averages a group's domains equally", () => {
    expect(scoreForLens(s, { kind: "category", id: "c1" }, categories)).toBeCloseTo(0.6);
  });

  /* A group whose domains the school has never been scored on is unscored.
     Counting the missing domains as zero would drop a school into Needs
     Improvement for never having been observed. */
  it("returns null for a group with no scored domains, not 0", () => {
    expect(scoreForLens(s, { kind: "category", id: "c2" }, categories)).toBeNull();
  });

  it("returns null for a domain the school has no score for", () => {
    expect(scoreForLens(s, { kind: "domain", id: "nope" }, categories)).toBeNull();
  });
});

describe("buildBandMatrix", () => {
  const schools = [
    school("Alpha",   "NYC",     0.85),
    school("Bravo",   "NYC",     0.62),
    school("Charlie", "NYC",     0.21),
    school("Delta",   "NYC",     null),
    school("Echo",    "Newark",  0.95),
  ];

  it("draws all five regions even when a region has no schools", () => {
    const rows = buildBandMatrix(schools, { kind: "overall" }, categories);
    expect(rows.map((r) => r.region)).toEqual(["Boston", "Camden", "NYC", "Newark", "Rochester"]);
    expect(rows.find((r) => r.region === "Boston")!.total).toBe(0);
  });

  it("splits one region across all four columns", () => {
    const nyc = buildBandMatrix(schools, { kind: "overall" }, categories).find((r) => r.region === "NYC")!;
    expect(nyc.bands.proficient.map((b) => b.school.name)).toEqual(["Alpha"]);
    expect(nyc.bands.working.map((b) => b.school.name)).toEqual(["Bravo"]);
    expect(nyc.bands.needs.map((b) => b.school.name)).toEqual(["Charlie"]);
    expect(nyc.bands.unscored.map((b) => b.school.name)).toEqual(["Delta"]);
    expect(nyc.total).toBe(4);
  });

  it("orders a band strongest first, so the last name is the one to go to", () => {
    const rows = buildBandMatrix(
      [school("Low", "NYC", 0.1), school("Mid", "NYC", 0.4), school("High", "NYC", 0.45)],
      { kind: "overall" },
      categories,
    );
    const needs = rows.find((r) => r.region === "NYC")!.bands.needs;
    expect(needs.map((b) => b.school.name)).toEqual(["High", "Mid", "Low"]);
  });

  it("regroups the same schools when the lens changes to a domain", () => {
    const byDomain = buildBandMatrix(
      [school("Alpha", "NYC", 0.85, { d1: 0.2 })],
      { kind: "domain", id: "d1" },
      categories,
    ).find((r) => r.region === "NYC")!;
    expect(byDomain.bands.proficient).toHaveLength(0);
    expect(byDomain.bands.needs.map((b) => b.school.name)).toEqual(["Alpha"]);
  });

  /* An unexpected region is a data problem worth seeing. Dropping the school
     would make it disappear from the network's own view of itself. */
  it("appends a region the data carries that is not one of the five", () => {
    const rows = buildBandMatrix([school("Odd", "Atlantis", 0.9)], { kind: "overall" }, categories);
    expect(rows.map((r) => r.region)).toContain("Atlantis");
    expect(rows.find((r) => r.region === "Atlantis")!.bands.proficient).toHaveLength(1);
  });
});

describe("lensOptionsFor", () => {
  it("offers nothing to pick for the whole rubric", () => {
    expect(lensOptionsFor("overall", categories)).toEqual([]);
  });

  it("offers the groups, then every domain flattened across them", () => {
    expect(lensOptionsFor("category", categories).map((o) => o.label)).toEqual(["Instruction", "Culture"]);
    expect(lensOptionsFor("domain", categories).map((o) => o.label)).toEqual(["Pacing", "Checks", "Routines"]);
  });
});
