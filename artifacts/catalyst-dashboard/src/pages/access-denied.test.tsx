// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AccessDeniedPage from "./access-denied";

/* ── AccessDeniedPage — email contact path ───────────────────────────────────
 * Guards that the access-denied page renders the correct Catalyst Support
 * email address and that the mailto href is exactly right.  A future copy
 * change that silently drops or mistyped the address would break the only
 * contact path available to locked-out users.
 * ─────────────────────────────────────────────────────────────────────────── */

const SUPPORT_EMAIL = "catalyst@uncommonschools.org";

describe("Dashboard AccessDeniedPage — Catalyst Support email", () => {
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

  it("prompts users to confirm they are using their Uncommon Schools email", () => {
    render(<AccessDeniedPage />);
    expect(screen.getByText("Uncommon Schools email address")).toBeTruthy();
  });

  it("renders the 'Back to Sign In' button linking to /login", () => {
    render(<AccessDeniedPage />);
    const backLink = screen.getByRole("link", { name: /back to sign in/i });
    expect(backLink.getAttribute("href")).toBe("/login");
  });
});
