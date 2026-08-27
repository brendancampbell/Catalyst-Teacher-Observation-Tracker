import { describe, it, expect } from "vitest";
import type { DashboardData } from "@workspace/api-types";
import { withoutObservation } from "@/lib/observation-cache";

const obs = (id: string) => ({
  id,
  date: "2026-05-01",
  scores: {},
  observer: "Someone",
}) as unknown as DashboardData["teachers"][number]["observations"][number];

const data = (): DashboardData => ({
  rubricSet: { id: 1, slug: "q1", name: "Q1" },
  schoolGradeSpan: "HS",
  categories: [],
  teachers: [
    { id: "t1", name: "Ada", observations: [obs("o1"), obs("o2")] },
    { id: "t2", name: "Grace", observations: [obs("o3")] },
  ] as unknown as DashboardData["teachers"],
});

describe("withoutObservation", () => {
  it("removes the deleted observation", () => {
    const next = withoutObservation(data(), "o1");
    expect(next.teachers[0]!.observations.map((o) => o.id)).toEqual(["o2"]);
  });

  it("leaves every other teacher alone", () => {
    const before = data();
    const next = withoutObservation(before, "o1");
    /* Same object, not a copy — an untouched teacher must not force a re-render
       of their row. */
    expect(next.teachers[1]).toBe(before.teachers[1]);
  });

  it("returns the payload untouched when the observation is not in it", () => {
    /* The same delete is applied to every cached dashboard, most of which never
       held the observation. Those must come back identical so React Query can
       skip the update. */
    const before = data();
    expect(withoutObservation(before, "nope")).toBe(before);
  });

  it("does not mutate the payload it was given", () => {
    const before = data();
    withoutObservation(before, "o1");
    expect(before.teachers[0]!.observations).toHaveLength(2);
  });
});
