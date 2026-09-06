import { afterEach, describe, expect, it, vi } from "vitest";
import { trackEvent } from "@/lib/analytics";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("trackEvent", () => {
  it("forwards approved, privacy-safe event properties to Umami", () => {
    const track = vi.fn();
    window.umami = { track };

    trackEvent("observation_submitted", {
      surface: "mobile",
      observation_kind: "walkthrough",
      outcome: "updated",
      action_step_outcome: "mastered",
    });

    expect(track).toHaveBeenCalledWith("observation_submitted", {
      surface: "mobile",
      observation_kind: "walkthrough",
      outcome: "updated",
      action_step_outcome: "mastered",
    });
  });

  it("is a no-op when the injected tracker is unavailable", () => {
    delete window.umami;

    expect(() => trackEvent("draft_saved")).not.toThrow();
  });

  it("is a no-op during server rendering", () => {
    vi.stubGlobal("window", undefined);

    expect(() => trackEvent("draft_saved")).not.toThrow();
  });

  it("swallows tracker failures", () => {
    window.umami = { track: vi.fn(() => { throw new Error("tracker failed"); }) };

    expect(() => trackEvent("draft_discarded")).not.toThrow();
  });
});