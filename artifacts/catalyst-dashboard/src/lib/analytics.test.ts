// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { trackEvent } from "@/lib/analytics";

afterEach(() => {
  delete window.umami;
});

describe("trackEvent", () => {
  it("forwards a typed dashboard outcome to Umami", () => {
    const track = vi.fn();
    window.umami = { track };

    trackEvent("draft_saved", { surface: "dashboard" });

    expect(track).toHaveBeenCalledWith("draft_saved", { surface: "dashboard" });
  });

  it("is a no-op when the injected tracker is unavailable", () => {
    expect(() => trackEvent("draft_discarded", { surface: "dashboard" })).not.toThrow();
  });

  it("isolates tracker failures from the caller", () => {
    window.umami = { track: vi.fn(() => { throw new Error("tracker unavailable"); }) };

    expect(() => trackEvent("feedback_email_copied", { surface: "dashboard" })).not.toThrow();
  });
});