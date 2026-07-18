/**
 * COACH role — full observation flow integration tests
 *
 * Covers the three-step journey a COACH user takes after login:
 *
 *   Step 1 (LoginPage):      COACH is redirected to /rubric-picker,
 *                             NOT to /school-picker (that is for network-scope roles).
 *
 *   Step 2 (RubricPickerPage): COACH sees available rubrics and can select one,
 *                              which calls setSelectedRubric and navigates to /observation.
 *
 *   Step 3 (ObservationPage): Form renders, COACH can fill strengths/growth-areas
 *                              and submit; the API call is made with correct payload.
 *
 * These tests close the gap left when the role was mislabelled "TEACHER" —
 * the actual routing and submission logic was untested at the component level.
 */

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Shared mock state ─────────────────────────────────────────────────────
// We need to track navigate calls and selectedRubric mutations across pages.

const mockNavigate = vi.fn();
let capturedSelectedRubric: unknown = null;

const mockSetSelectedRubric = vi.fn((rubric: unknown) => {
  capturedSelectedRubric = rubric;
});

const COACH_USER = {
  id: 99,
  role: "COACH" as const,
  schoolId: 5,
  schoolName: "Catalyst Academy",
};

const RUBRIC_SET = {
  id: 3,
  slug: "coach-rubric",
  name: "Coach Observation Rubric",
  subjectAudience: "ALL" as const,
  target: "TEACHER" as const,
  isArchived: false,
};

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

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("wouter", () => ({
  useLocation: () => ["", mockNavigate],
  useSearch: () => "",
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: COACH_USER,
    isLoading: false,
    signOut: vi.fn(),
    refetch: vi.fn(),
  }),
}));

vi.mock("@/context/AppContext", () => ({
  useApp: vi.fn(),
}));

vi.mock("@/components/AppHeader", () => ({
  AppHeader: () => null,
}));

vi.mock("@/lib/roles", () => ({
  isNetworkScope: (user: { role: string } | null | undefined) =>
    user?.role === "NETWORK_ADMIN" || user?.role === "NETWORK_LEADER",
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

// ── Helpers ───────────────────────────────────────────────────────────────

import { useApp } from "@/context/AppContext";

function setupAppContext(overrides: {
  selectedSchool?: unknown;
  selectedRubric?: unknown;
} = {}) {
  (useApp as ReturnType<typeof vi.fn>).mockReturnValue({
    selectedSchool: overrides.selectedSchool ?? null,
    setSelectedSchool: vi.fn(),
    selectedRubric: overrides.selectedRubric ?? null,
    setSelectedRubric: mockSetSelectedRubric,
  });
}

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
}

function wrap(element: React.ReactElement) {
  return render(
    <QueryClientProvider client={makeClient()}>{element}</QueryClientProvider>,
  );
}

// ── Tests — Step 1: Login routing ─────────────────────────────────────────

import LoginPage from "@/pages/login";

vi.stubGlobal("import", { meta: { env: { BASE_URL: "/" } } });

describe("Step 1 — COACH login routing", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    setupAppContext();
  });

  it("redirects COACH to /rubric-picker (not /school-picker)", () => {
    render(<LoginPage />);
    expect(mockNavigate).toHaveBeenCalledWith("/rubric-picker");
    expect(mockNavigate).not.toHaveBeenCalledWith("/school-picker");
    expect(mockNavigate).not.toHaveBeenCalledWith("/observation");
  });

  it("redirects COACH with rubric already selected directly to /observation", () => {
    setupAppContext({ selectedRubric: RUBRIC_SET });
    render(<LoginPage />);
    expect(mockNavigate).toHaveBeenCalledWith("/observation");
    expect(mockNavigate).not.toHaveBeenCalledWith("/rubric-picker");
    expect(mockNavigate).not.toHaveBeenCalledWith("/school-picker");
  });
});

// ── Tests — Step 2: RubricPickerPage ─────────────────────────────────────

import RubricPickerPage from "@/pages/rubric-picker";

describe("Step 2 — COACH rubric selection", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockSetSelectedRubric.mockClear();
    capturedSelectedRubric = null;
    setupAppContext();

    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes("/api/rubric/sets")) return Promise.resolve([RUBRIC_SET]);
      return Promise.resolve([]);
    });
  });

  it("does not redirect COACH to /school-picker when selectedSchool is null", async () => {
    wrap(<RubricPickerPage />);
    // Give it time to run effects / render
    await waitFor(() =>
      expect(mockNavigate).not.toHaveBeenCalledWith("/school-picker"),
    );
  });

  it("shows the available rubric set", async () => {
    wrap(<RubricPickerPage />);
    await waitFor(() =>
      expect(screen.getByText("Coach Observation Rubric")).toBeInTheDocument(),
    );
  });

  it("calls setSelectedRubric and navigates to /observation when rubric is clicked", async () => {
    wrap(<RubricPickerPage />);
    await waitFor(() =>
      expect(screen.getByText("Coach Observation Rubric")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("Coach Observation Rubric"));
    expect(mockSetSelectedRubric).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }));
    expect(mockNavigate).toHaveBeenCalledWith("/observation");
  });
});

// ── Tests — Step 3: ObservationPage ──────────────────────────────────────

import ObservationPage from "@/pages/observation";

describe("Step 3 — COACH observation form", () => {
  beforeEach(() => {
    localStorage.clear();
    mockNavigate.mockClear();
    vi.clearAllMocks();

    setupAppContext({ selectedRubric: RUBRIC_SET });

    mockFetchMyDrafts.mockResolvedValue([]);

    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes("/api/people"))              return Promise.resolve([TEACHER]);
      if (url.includes("/api/rubric/"))             return Promise.resolve(RUBRIC_DATA);
      if (url.includes("/api/action-steps/latest")) return Promise.resolve(null);
      // Observation submit endpoint
      if (url.includes("/api/observations")) return Promise.resolve({ id: "obs-001" });
      return Promise.resolve({});
    });
  });

  it("renders the form without redirecting away (COACH has no schoolId requirement)", async () => {
    wrap(<ObservationPage />);
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("What is this teacher doing well?"),
      ).toBeInTheDocument(),
    );
    expect(mockNavigate).not.toHaveBeenCalledWith("/school-picker");
  });

  it("shows both strengths and growth-areas fields", async () => {
    wrap(<ObservationPage />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("What is this teacher doing well?")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("Where should this teacher focus next?")).toBeInTheDocument();
    });
  });

  it("displays the teacher name in the select dropdown", async () => {
    wrap(<ObservationPage />);
    await waitFor(() =>
      expect(screen.getByText(/Jordan Lee/)).toBeInTheDocument(),
    );
  });

  it("submits the observation via apiFetch POST when the form is submitted", async () => {
    wrap(<ObservationPage />);

    // Wait for form to appear (teacher list loaded)
    await waitFor(() =>
      expect(screen.getByPlaceholderText("What is this teacher doing well?")).toBeInTheDocument(),
    );

    // Fill in strengths field
    await act(async () => {
      fireEvent.change(
        screen.getByPlaceholderText("What is this teacher doing well?"),
        { target: { value: "Strong lesson structure and clear objectives" } },
      );
    });

    // Submit the form by clicking the Submit button
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    });

    // The POST to /api/observations must have been called
    await waitFor(() => {
      const postCall = mockApiFetch.mock.calls.find(
        ([url, opts]: [string, RequestInit | undefined]) =>
          url.includes("/api/observations") && opts?.method === "POST",
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1]!.body as string) as Record<string, unknown>;
      expect(body.observedEmployeeId).toBe("emp-c01");
      expect(body.rubricSetId).toBe(3);
    });
  });
});
