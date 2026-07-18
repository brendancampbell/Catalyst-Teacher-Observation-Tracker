/**
 * Login routing tests
 *
 * Verifies that LoginPage redirects each role to the correct first screen
 * after a successful authentication:
 *
 *  - NETWORK_ADMIN  → /school-picker  (no school selected)
 *  - NETWORK_LEADER → /school-picker  (no school selected)
 *  - SCHOOL_LEADER  → /rubric-picker  (school implicit, no rubric selected)
 *  - COACH          → /rubric-picker  (school implicit, no rubric selected)
 *
 * Additionally verifies that a fully-configured session (school + rubric
 * already chosen) skips both pickers and lands on /observation.
 */

import React from "react";
import { render } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import type { User } from "@/lib/api";

/* ── Mocks ───────────────────────────────────────────────────────────────── */

const mockNavigate = vi.fn();

vi.mock("wouter", () => ({
  useLocation: () => ["", mockNavigate],
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("@/context/AppContext", () => ({
  useApp: vi.fn(),
}));

/* Silence import.meta.env.BASE_URL in LoginPage */
vi.stubGlobal("import", {
  meta: { env: { BASE_URL: "/" } },
});

import { useAuth } from "@/context/AuthContext";
import { useApp } from "@/context/AppContext";
import LoginPage from "@/pages/login";

/* ── Helpers ─────────────────────────────────────────────────────────────── */

type Role = User["role"];

function makeUser(role: Role): User {
  return { id: "u1", email: "test@example.com", name: "Test", role } as User;
}

function setupMocks(
  role: Role,
  opts: { selectedSchool?: object | null; selectedRubric?: object | null } = {},
) {
  const { selectedSchool = null, selectedRubric = null } = opts;
  (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
    user: makeUser(role),
    isLoading: false,
    signOut: vi.fn(),
    refetch: vi.fn(),
  });
  (useApp as ReturnType<typeof vi.fn>).mockReturnValue({
    selectedSchool,
    setSelectedSchool: vi.fn(),
    selectedRubric,
    setSelectedRubric: vi.fn(),
  });
}

/* ── Tests ───────────────────────────────────────────────────────────────── */

describe("LoginPage routing after authentication", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it("redirects NETWORK_ADMIN to /school-picker when no school is selected", () => {
    setupMocks("NETWORK_ADMIN");
    render(<LoginPage />);
    expect(mockNavigate).toHaveBeenCalledWith("/school-picker");
    expect(mockNavigate).not.toHaveBeenCalledWith("/rubric-picker");
    expect(mockNavigate).not.toHaveBeenCalledWith("/observation");
  });

  it("redirects NETWORK_LEADER to /school-picker when no school is selected", () => {
    setupMocks("NETWORK_LEADER");
    render(<LoginPage />);
    expect(mockNavigate).toHaveBeenCalledWith("/school-picker");
    expect(mockNavigate).not.toHaveBeenCalledWith("/rubric-picker");
    expect(mockNavigate).not.toHaveBeenCalledWith("/observation");
  });

  it("redirects SCHOOL_LEADER to /rubric-picker (bypasses school-picker)", () => {
    setupMocks("SCHOOL_LEADER");
    render(<LoginPage />);
    expect(mockNavigate).not.toHaveBeenCalledWith("/school-picker");
    expect(mockNavigate).toHaveBeenCalledWith("/rubric-picker");
    expect(mockNavigate).not.toHaveBeenCalledWith("/observation");
  });

  it("redirects COACH to /rubric-picker (bypasses school-picker)", () => {
    setupMocks("COACH");
    render(<LoginPage />);
    expect(mockNavigate).not.toHaveBeenCalledWith("/school-picker");
    expect(mockNavigate).toHaveBeenCalledWith("/rubric-picker");
    expect(mockNavigate).not.toHaveBeenCalledWith("/observation");
  });

  it("redirects COACH with rubric already selected to /observation", () => {
    setupMocks("COACH", {
      selectedRubric: { id: "r1", name: "Sample Rubric" },
    });
    render(<LoginPage />);
    expect(mockNavigate).not.toHaveBeenCalledWith("/school-picker");
    expect(mockNavigate).not.toHaveBeenCalledWith("/rubric-picker");
    expect(mockNavigate).toHaveBeenCalledWith("/observation");
  });

  it("redirects SCHOOL_LEADER with rubric already selected to /observation", () => {
    setupMocks("SCHOOL_LEADER", {
      selectedRubric: { id: "r1", name: "Sample Rubric" },
    });
    render(<LoginPage />);
    expect(mockNavigate).toHaveBeenCalledWith("/observation");
  });

  it("NETWORK_ADMIN with school already selected skips school-picker and goes to /rubric-picker", () => {
    setupMocks("NETWORK_ADMIN", {
      selectedSchool: { id: "s1", name: "Test School" },
    });
    render(<LoginPage />);
    expect(mockNavigate).not.toHaveBeenCalledWith("/school-picker");
    expect(mockNavigate).toHaveBeenCalledWith("/rubric-picker");
  });

  it("NETWORK_LEADER with school already selected skips school-picker and goes to /rubric-picker", () => {
    setupMocks("NETWORK_LEADER", {
      selectedSchool: { id: "s1", name: "Test School" },
    });
    render(<LoginPage />);
    expect(mockNavigate).not.toHaveBeenCalledWith("/school-picker");
    expect(mockNavigate).toHaveBeenCalledWith("/rubric-picker");
  });

  it("does not navigate while still loading auth", () => {
    (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
      user: null,
      isLoading: true,
      signOut: vi.fn(),
      refetch: vi.fn(),
    });
    (useApp as ReturnType<typeof vi.fn>).mockReturnValue({
      selectedSchool: null,
      setSelectedSchool: vi.fn(),
      selectedRubric: null,
      setSelectedRubric: vi.fn(),
    });
    render(<LoginPage />);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
