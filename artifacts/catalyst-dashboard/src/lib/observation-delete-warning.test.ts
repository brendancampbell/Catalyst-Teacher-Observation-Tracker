import { describe, it, expect } from "vitest";
import { buildObservationDeleteHeading } from "@/lib/observation-delete-warning";

const open     = (text: string) => ({ id: 1, text, mastered: false });
const mastered = (text: string) => ({ id: 2, text, mastered: true });

describe("buildObservationDeleteHeading", () => {
  it("says nothing when nothing would be lost", () => {
    expect(buildObservationDeleteHeading([])).toBeNull();
  });

  it("says MASTERED loudly when completed work would go", () => {
    /* Retracting something a coach assigned is one thing. Removing work the
       teacher has already done and been credited for is another, and the
       person clicking needs to see the difference. */
    const heading = buildObservationDeleteHeading([mastered("Tighten the do-now")]);
    expect(heading).toContain("MASTERED");
  });

  it("does not cry mastery over an open step", () => {
    const heading = buildObservationDeleteHeading([open("Tighten the do-now")]);
    expect(heading).not.toContain("MASTERED");
    expect(heading).toContain("the action step assigned in it");
  });

  it("flags mastery even when it is one of several", () => {
    const heading = buildObservationDeleteHeading([
      open("Cold call more widely"),
      mastered("Tighten the do-now"),
    ]);
    expect(heading).toContain("MASTERED");
  });

  it("counts several open steps", () => {
    const heading = buildObservationDeleteHeading([open("A"), open("B"), open("C")]);
    expect(heading).toContain("3 action steps");
  });

  it("is singular for one", () => {
    const heading = buildObservationDeleteHeading([open("A")]);
    expect(heading).toContain("the action step");
    expect(heading).not.toContain("1 action steps");
  });
});
