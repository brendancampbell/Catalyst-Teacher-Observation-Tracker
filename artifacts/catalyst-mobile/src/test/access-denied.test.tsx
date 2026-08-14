import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";

/* ── AccessDeniedPage — email contact path ───────────────────────────────────
 * Guards that the mobile access-denied page renders the correct Catalyst
 * Support email address and that the mailto href is exactly right.  A future
 * copy change that silently drops or mistyped the address would break the only
 * contact path available to locked-out users.
 * ─────────────────────────────────────────────────────────────────────────── */

// Stub import.meta.env.BASE_URL before the component module is loaded
beforeAll(() => {
  vi.stubGlobal("import", {
    meta: { env: { BASE_URL: "/catalyst-mobile/" } },
  });
});

import AccessDeniedPage from "@/pages/access-denied";

const SUPPORT_EMAIL = "catalyst@uncommonschools.org";

describe("Mobile AccessDeniedPage — Catalyst Support email", () => {
  it("renders the support email address as visible text", () => {
    render(<AccessDeniedPage />);
    expect(screen.getByText(SUPPORT_EMAIL)).toBeTruthy();
  });

  it("renders a mailto link pointing to the support address", () => {
    render(<AccessDeniedPage />);
    const link = screen.getByRole("link", { name: SUPPORT_EMAIL });
    expect(link.getAttribute("href")).toBe(`mailto:${SUPPORT_EMAIL}`);
  });

  it("renders 'Catalyst Support' as the visible label near the email", () => {
    render(<AccessDeniedPage />);
    expect(screen.getByText("Catalyst Support")).toBeTruthy();
  });

  it("renders the 'Back to Sign In' button", () => {
    render(<AccessDeniedPage />);
    expect(screen.getByRole("link", { name: /back to sign in/i })).toBeTruthy();
  });
});
