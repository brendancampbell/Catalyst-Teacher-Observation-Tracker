import { describe, it, expect } from "vitest";
import { domainScoreRows } from "@/components/DomainScorePanel";
import type { CategoryEntry, Observation } from "@workspace/api-types";

const categories = [
  { id: "c1", label: "Instruction", domains: [
    { id: "d1", label: "Planning" },
    { id: "d2", label: "Pacing" },
  ] },
] as CategoryEntry[];

const obs = (date: string, scores: Record<string, number>) =>
  ({ id: date, date, scores, observer: "Someone" }) as unknown as Observation;

describe("domain score rows", () => {
  /* Shared by a teacher's page and a school's, so the arithmetic has to be
     right once rather than twice. */

  it("takes the most recent score for each domain", () => {
    const rows = domainScoreRows(categories, [
      obs("2026-08-01", { d1: 0 }),
      obs("2026-08-20", { d1: 1 }),
    ]);
    expect(rows.find((r) => r.domain.id === "d1")!.recentScore).toBe(1);
  });

  it("averages every score on record, not just the recent ones", () => {
    const rows = domainScoreRows(categories, [
      obs("2026-08-01", { d1: 0 }),
      obs("2026-08-20", { d1: 1 }),
    ]);
    expect(rows.find((r) => r.domain.id === "d1")!.avg).toBe(0.5);
  });

  describe("the trend", () => {
    it("measures the latest against the earliest, not against last time", () => {
      /* So a single bad day in the middle does not read as a decline. */
      const rows = domainScoreRows(categories, [
        obs("2026-08-01", { d1: 0 }),
        obs("2026-08-10", { d1: 1 }),
        obs("2026-08-20", { d1: 0.5 }),
      ]);
      expect(rows.find((r) => r.domain.id === "d1")!.trend).toBe(0.5);
    });

    it("is flat with only one score to go on", () => {
      const rows = domainScoreRows(categories, [obs("2026-08-01", { d1: 1 })]);
      expect(rows.find((r) => r.domain.id === "d1")!.trend).toBe(0);
    });

    it("reads the dates rather than the order they arrive in", () => {
      /* The server sends newest first for a school and oldest first for a
         teacher. The answer must not depend on which. */
      const ascending  = domainScoreRows(categories, [obs("2026-08-01", { d1: 0 }), obs("2026-08-20", { d1: 1 })]);
      const descending = domainScoreRows(categories, [obs("2026-08-20", { d1: 1 }), obs("2026-08-01", { d1: 0 })]);
      expect(ascending.find((r) => r.domain.id === "d1")!.trend).toBe(1);
      expect(descending.find((r) => r.domain.id === "d1")!.trend).toBe(1);
      expect(descending.find((r) => r.domain.id === "d1")!.recentScore).toBe(1);
    });

    it("ignores observations that never scored the domain", () => {
      const rows = domainScoreRows(categories, [
        obs("2026-08-01", { d1: 0 }),
        obs("2026-08-10", { d2: 1 }),
        obs("2026-08-20", { d1: 1 }),
      ]);
      expect(rows.find((r) => r.domain.id === "d1")!.trend).toBe(1);
    });
  });

  it("says nothing rather than zero for a domain never scored", () => {
    const rows = domainScoreRows(categories, [obs("2026-08-01", { d1: 1 })]);
    const pacing = rows.find((r) => r.domain.id === "d2")!;
    expect(pacing.avg).toBeNull();
    expect(pacing.recentScore).toBeUndefined();
  });

  it("copes with a school that has never been observed", () => {
    const rows = domainScoreRows(categories, []);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.avg === null && r.trend === 0)).toBe(true);
  });
});
