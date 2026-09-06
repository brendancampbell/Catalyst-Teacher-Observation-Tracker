import { describe, expect, it } from "vitest";
import { trackEvent } from "@/lib/analytics";

describe("trackEvent on the server", () => {
  it("is a no-op without window", () => {
    expect(() => trackEvent("draft_saved", { surface: "dashboard" })).not.toThrow();
  });
});