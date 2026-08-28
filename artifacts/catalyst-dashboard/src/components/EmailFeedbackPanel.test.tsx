// @vitest-environment jsdom
/**
 * The five include-in-email toggles.
 *
 * They were a stacked list of checkboxes and pushed the opening message off a
 * laptop screen; they are one wrapping row of chips now. The behaviour they
 * carry is what is tested here — what is offered, what is refused, and the
 * dependency between the two rubric choices.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EmailFeedbackPanel } from "@/components/EmailFeedbackPanel";
import type { EmailSource } from "@/lib/observation-email";

const src = (over: Partial<EmailSource> = {}): EmailSource => ({
  teacher: { name: "Meg Salta", firstName: "Meg", email: "meg@school.edu", subject: "Math", gradeLevel: ["9"] },
  date: "2026-08-20",
  time: "09:15",
  course: "Algebra I",
  observerName: "Ada Coach",
  categories: [{ id: "c1", label: "Instruction", domains: [
    { id: "d1", label: "Planning" }, { id: "d2", label: "Pacing" },
  ] }] as EmailSource["categories"],
  scores: { d1: 1 },
  strengths: "Clear directions",
  growthAreas: "Tighten the do-now",
  steps: {},
  priorObservations: [],
  ...over,
});

function show(over: Partial<EmailSource> = {}) {
  render(React.createElement(EmailFeedbackPanel, {
    src: src(over),
    initialIntro: "Dear Meg,",
    initialGlows: "Clear directions",
    initialGrows: "Tighten the do-now",
    onClose: vi.fn(),
  }));
}

const chip = (name: RegExp) => screen.getByRole("button", { name });

describe("Include in Email", () => {
  it("offers all five, whether or not they apply", () => {
    show();
    for (const label of [/Scored rubric rows/, /Unscored rubric rows/, /Glows/, /Grows/, /Action steps/]) {
      expect(chip(label)).toBeTruthy();
    }
  });

  it("starts with all five turned on", () => {
    show();
    for (const label of [/Scored rubric rows/, /Unscored rubric rows/, /Glows/, /Grows/, /Action steps/]) {
      expect(chip(label).getAttribute("aria-pressed")).toBe("true");
    }
  });

  it("leaves a chip on even when the observation has nothing of that kind", () => {
    /* This observation has no action step. The chip stays on and clickable —
       the section simply prints nothing. Greying it read as the tool
       overruling the observer, and bought nothing. */
    show();
    const steps = chip(/Action steps/);
    expect(steps.hasAttribute("disabled")).toBe(false);
    expect(steps.getAttribute("aria-pressed")).toBe("true");
  });

  it("greys nothing but the one real dependency", () => {
    show({ scores: {}, strengths: "", growthAreas: "", steps: {} });
    for (const label of [/Scored rubric rows/, /Glows/, /Grows/, /Action steps/]) {
      expect(chip(label).hasAttribute("disabled")).toBe(false);
    }
  });

  it("turns one off when clicked", () => {
    show();
    fireEvent.click(chip(/Glows/));
    expect(chip(/Glows/).getAttribute("aria-pressed")).toBe("false");
  });

  describe("the unscored rows depend on the scored ones", () => {
    it("switches off and locks when the scored rows go", () => {
      show();
      expect(chip(/Unscored rubric rows/).getAttribute("aria-pressed")).toBe("true");

      fireEvent.click(chip(/Scored rubric rows/));

      const unscored = chip(/Unscored rubric rows/);
      expect(unscored.hasAttribute("disabled")).toBe(true);
      expect(unscored.getAttribute("aria-pressed")).toBe("false");
    });

    it("comes back as it was when the scored rows return", () => {
      show();
      fireEvent.click(chip(/Scored rubric rows/));
      fireEvent.click(chip(/Scored rubric rows/));
      expect(chip(/Unscored rubric rows/).getAttribute("aria-pressed")).toBe("true");
    });

    it("ignores a click while it is locked", () => {
      show();
      fireEvent.click(chip(/Scored rubric rows/));
      fireEvent.click(chip(/Unscored rubric rows/));
      expect(chip(/Unscored rubric rows/).getAttribute("aria-pressed")).toBe("false");
    });
  });

  it("has no subject line — the copied email carries none", () => {
    show();
    expect(screen.queryByText(/Subject Line/i)).toBeNull();
  });
});
