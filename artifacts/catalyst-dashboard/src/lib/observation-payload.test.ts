import { describe, it, expect } from "vitest";
import {
  observationCreatePayload,
  observationUpdatePayload,
  type ObservationFormFields,
} from "@workspace/api-types";

const form = (over: Partial<ObservationFormFields> = {}): ObservationFormFields => ({
  teacherId:     "emp-1",
  rubricSetId:   3,
  date:          "2026-08-20",
  time:          "09:15",
  course:        "Algebra I",
  scores:        { "d-1": 0.5 },
  strengths:     "<p>Glows</p>",
  growthAreas:   "<p>Grows</p>",
  isWalkthrough: true,
  ...over,
});

describe("the one definition of an observation", () => {
  /* The defect these exist for: publishing sent the writing and left the facts
     behind, so the walkthrough toggle survived only if a two-second autosave
     happened to land first. Both builders must carry the facts. */
  it("sends the walkthrough flag when creating", () => {
    expect(observationCreatePayload(form(), "published").isWalkthrough).toBe(true);
  });

  it("sends the walkthrough flag when updating", () => {
    expect(observationUpdatePayload(form(), "published").isWalkthrough).toBe(true);
  });

  it("sends a flag that was turned back off, not just one turned on", () => {
    const off = form({ isWalkthrough: false });
    expect(observationCreatePayload(off, "published").isWalkthrough).toBe(false);
    expect(observationUpdatePayload(off, "published").isWalkthrough).toBe(false);
  });

  it("carries the date, time and course on an update", () => {
    const p = observationUpdatePayload(form(), "published");
    expect(p).toMatchObject({ date: "2026-08-20", time: "09:15", course: "Algebra I" });
  });

  it("passes the status through", () => {
    expect(observationCreatePayload(form(), "draft").status).toBe("draft");
    expect(observationUpdatePayload(form(), "published").status).toBe("published");
  });

  /* An observation is created once and updated many times. Restating the
     observer on every autosave would let a later save rewrite who filed it. */
  it("records the observer on creation only", () => {
    const created = observationCreatePayload(
      { ...form(), observer: "Ada", observerId: 7 }, "draft");
    expect(created).toMatchObject({ observer: "Ada", observerId: 7 });
    expect(observationUpdatePayload(form(), "published")).not.toHaveProperty("observer");
  });

  describe("empty fields", () => {
    /* The server reads a missing optional field as "leave it alone" and an
       empty string as a value, so the two are not interchangeable. */
    it("omits an untyped course when creating rather than writing an empty one", () => {
      const p = observationCreatePayload(form({ course: "", time: "" }), "published");
      expect(p.course).toBeUndefined();
      expect(p.time).toBeUndefined();
    });

    it("clears a removed course when updating", () => {
      /* Here the blank means the observer took it out, which has to be written. */
      const p = observationUpdatePayload(form({ course: "", time: "" }), "published");
      expect(p.course).toBeNull();
      expect(p.time).toBeNull();
    });

    it("keeps a real value in both", () => {
      expect(observationCreatePayload(form(), "published").course).toBe("Algebra I");
      expect(observationUpdatePayload(form(), "published").course).toBe("Algebra I");
    });
  });

  it("leaves the action-step extras out when there are none", () => {
    const p = observationCreatePayload(form(), "published");
    expect(p.newActionStep).toBeUndefined();
    expect(p.masterActionStepId).toBeUndefined();
    expect(p.extendActionStep).toBeUndefined();
  });

  it("carries an action step through both", () => {
    const step = { text: "Cold call more widely", dueDate: "2026-09-10" };
    expect(observationCreatePayload({ ...form(), newActionStep: step }, "published").newActionStep).toEqual(step);
    expect(observationUpdatePayload({ ...form(), newActionStep: step }, "published").newActionStep).toEqual(step);
  });
});
