import { describe, it, expect } from "vitest";
import { buildObservationDeleteWarning } from "@/lib/observation-delete-warning";

const open     = (text: string) => ({ id: 1, text, mastered: false });
const mastered = (text: string) => ({ id: 2, text, mastered: true });

describe("buildObservationDeleteWarning", () => {
  it("names the step rather than warning in the abstract", () => {
    const msg = buildObservationDeleteWarning([open("Tighten the do-now")]);
    expect(msg).toContain("Tighten the do-now");
    expect(msg).toContain("cannot be undone");
  });

  it("says MASTERED loudly when completed work would be lost", () => {
    /* Retracting something a coach assigned is one thing. Removing work the
       teacher has already done and been credited for is another, and the
       person clicking needs to see the difference. */
    const msg = buildObservationDeleteWarning([mastered("Tighten the do-now")]);
    expect(msg).toContain("MASTERED");
    expect(msg).toContain("already mastered");
    expect(msg).toMatch(/disappear from their record/i);
  });

  it("does not cry mastery over an open step", () => {
    const msg = buildObservationDeleteWarning([open("Tighten the do-now")]);
    expect(msg).not.toContain("MASTERED");
    expect(msg).not.toMatch(/disappear from their record/i);
  });

  it("flags mastery even when it is one of several", () => {
    const msg = buildObservationDeleteWarning([
      open("Cold call more widely"),
      mastered("Tighten the do-now"),
    ]);
    expect(msg).toContain("MASTERED");
    expect(msg).toContain("Cold call more widely");
    expect(msg).toContain("Tighten the do-now");
  });

  it("counts several open steps", () => {
    const msg = buildObservationDeleteWarning([
      open("First"), open("Second"), open("Third"),
    ]);
    expect(msg).toContain("3 action steps");
  });

  it("still asks when nothing would be lost", () => {
    const msg = buildObservationDeleteWarning([]);
    expect(msg).toMatch(/delete this observation/i);
    expect(msg).toContain("cannot be undone");
  });

  it("lists every step, so nothing is hidden behind a count", () => {
    const steps = [open("Alpha"), open("Beta"), mastered("Gamma")];
    const msg = buildObservationDeleteWarning(steps);
    for (const s of steps) expect(msg).toContain(s.text);
  });
});
