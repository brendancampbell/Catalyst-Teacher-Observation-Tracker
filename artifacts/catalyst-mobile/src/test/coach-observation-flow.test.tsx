/**
 * COACH role — observation page integration tests
 *
 * The login-routing tests confirm that a COACH user is redirected to
 * /rubric-picker (not /school-picker) and, once a rubric is selected,
 * to /observation. These tests verify the ObservationPage itself:
 *
 *   • renders without redirecting away for a COACH user
 *   • shows the teacher list, strengths, and growth-areas fields
 *   • does NOT require a selectedSchool (COACH is not network-scoped)
 *
 * This closes the gap that existed when the role was mislabelled "TEACHER"
 * in tests — the behaviour was untested at the component level.
 */

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ObservationPage from "@/pages/observation";

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: 99,
      role: "COACH",
      schoolId: 5,
      schoolName: "Catalyst Academy",
    },
    isLoading: false,
  }),
}));

vi.mock("@/context/AppContext", () => ({
  useApp: () => ({
    selectedSchool: null,   // COACH does not need selectedSchool
    selectedRubric: {
      id: 3,
      slug: "coach-rubric",
      name: "Coach Observation Rubric",
      subjectAudience: "ALL",
    },
    setSelectedSchool: vi.fn(),
  }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/observation", vi.fn()],
  useSearch: () => "",
}));

vi.mock("@/components/AppHeader", () => ({
  AppHeader: () => null,
}));

vi.mock("@/lib/roles", () => ({
  isNetworkScope: () => false,  // COACH is never network-scoped
}));

vi.mock("@/lib/subject-audience", () => ({
  teacherMatchesAudience: () => true,
}));

const mockApiFetch = vi.fn();
const mockFetchMyDrafts = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => mockApiFetch(...args),
    fetchMyDrafts: (...args: unknown[]) => mockFetchMyDrafts(...args),
    createObservation: vi.fn(),
    updateObservation: vi.fn(),
  };
});

// ── Fixtures ──────────────────────────────────────────────────────────────

const TEACHER = {
  employeeId: "emp-c01",
  id: "emp-c01",
  name: "Jordan Lee",
  firstName: "Jordan",
  lastName: "Lee",
  department: "Math",
  isActive: true,
};

const RUBRIC_DATA = {
  rubricSet: { id: 3, slug: "coach-rubric", name: "Coach Observation Rubric" },
  categories: [],
};

// ── Helpers ───────────────────────────────────────────────────────────────

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
}

function renderPage() {
  return render(
    <QueryClientProvider client={makeClient()}>
      <ObservationPage />
    </QueryClientProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("ObservationPage — COACH role", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();

    mockFetchMyDrafts.mockResolvedValue([]);

    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes("/api/people"))              return Promise.resolve([TEACHER]);
      if (url.includes("/api/rubric/"))             return Promise.resolve(RUBRIC_DATA);
      if (url.includes("/api/action-steps/latest")) return Promise.resolve(null);
      return Promise.resolve({});
    });
  });

  it("renders the observation form without redirecting away", async () => {
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("What is this teacher doing well?"),
      ).toBeInTheDocument();
    });
  });

  it("shows the growth-areas field", async () => {
    renderPage();
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("Where should this teacher focus next?"),
      ).toBeInTheDocument();
    });
  });

  it("lists the teacher returned by the API", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/Jordan.*Lee|Lee.*Jordan/)).toBeInTheDocument();
    });
  });

  it("does not show a school-picker redirect when no school is selected (COACH is school-scoped)", async () => {
    /*
     * ObservationPage navigates to /school-picker only when
     * isNetworkScope(user) === true AND selectedSchool is null.
     * COACH is not network-scoped, so the form must be reachable
     * even with selectedSchool = null.
     */
    renderPage();
    // If a redirect had occurred, the form fields would not exist.
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("What is this teacher doing well?"),
      ).toBeInTheDocument();
    });
  });
});
