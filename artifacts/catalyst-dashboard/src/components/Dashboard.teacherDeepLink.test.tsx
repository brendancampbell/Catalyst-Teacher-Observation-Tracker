// @vitest-environment jsdom
/**
 * Regression guard: /?teacher=<id> must open that teacher's profile on a COLD
 * load — a full page navigation with nothing in the react-query cache, which is
 * what every teacher link in the Action Center produces.
 *
 * Failure mode prevented: the "sync view state → URL" effect runs on mount,
 * before the dashboard query resolves. teacherProfileId is still null at that
 * point, so it rewrote the URL without ?teacher= and the parameter was gone by
 * the time the teacher list arrived. The auto-open effect then never saw both
 * of its conditions true at once and the profile silently never opened —
 * leaving you on a working-looking dashboard with no sign anything had failed.
 *
 * The warm-cache path hid this: with teachers already in the cache both effects
 * run in the same commit, and the auto-open one is declared first.
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DashboardData, RubricSetRow } from "@/lib/api";

/* ── Hoisted mocks ──────────────────────────────────────────────────────── */
const { mockFetchDashboard, mockFetchRubricSets, mockFetchMyLatestRubricSlug } = vi.hoisted(() => ({
  mockFetchDashboard:           vi.fn(),
  mockFetchRubricSets:          vi.fn(),
  mockFetchMyLatestRubricSlug:  vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    fetchDashboard:          mockFetchDashboard,
    fetchRubricSets:         mockFetchRubricSets,
    fetchMyLatestRubricSlug: mockFetchMyLatestRubricSlug,
  };
});

/* ── Sub-components ─────────────────────────────────────────────────────── */
vi.mock("@/components/AppHeader",           () => ({ default: () => null }));
vi.mock("@/components/FilterMultiSelect",   () => ({ FilterMultiSelect: () => null }));
vi.mock("@/components/NewObservationModal", () => ({ NewObservationModal: () => null }));
vi.mock("@/components/DrillDownModal",      () => ({ DrillDownModal: () => null }));
vi.mock("@/components/DistrictDashboard",   () => ({ default: () => null }));
vi.mock("@/components/ImpersonationBanner", () => ({ default: () => null }));

/* The overlay IS the profile. Stubbed to name the teacher it opened on, so the
   assertion is "the right person's profile", not merely "something rendered". */
vi.mock("@/components/TeacherScoreOverlay", () => ({
  TeacherScoreOverlay: ({ teacher }: { teacher: { name: string } }) => (
    <div data-testid="profile-overlay">{teacher.name}</div>
  ),
}));

vi.mock("@/context/UserContext", () => ({
  useUser: () => ({
    currentUser: {
      id: 1, email: "leader@school.edu", name: "Test Leader",
      role: "SCHOOL_LEADER", schoolId: null, schoolName: null, schoolAbbreviation: null,
    },
    isLoading: false, refetch: async () => {}, isImpersonating: false, realUser: null,
  }),
  UserContext: {},
}));

/* ── wouter ─────────────────────────────────────────────────────────────── */
/* Reads the live URL and re-renders when history is rewritten, which is what
   the real wouter does. A static string here would hide the whole bug: the
   component under test is the one calling replaceState. */
vi.mock("wouter", () => {
  const subscribe = (cb: () => void) => {
    window.addEventListener("catalyst:test-navigate", cb);
    return () => window.removeEventListener("catalyst:test-navigate", cb);
  };
  const useSearch = () => {
    const [, force] = React.useReducer((n: number) => n + 1, 0);
    React.useEffect(() => subscribe(force), []);
    return window.location.search.replace(/^\?/, "");
  };
  return {
    useSearch,
    useLocation: () => [window.location.pathname, vi.fn()],
    Link: ({ children }: { children: React.ReactNode }) => children,
  };
});

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }

/* ── Fixtures ───────────────────────────────────────────────────────────── */
const RUBRIC_SLUG = "test-rubric";
const EMPLOYEE_ID = "UCS-004821";

const MOCK_RUBRIC_SETS: RubricSetRow[] = [{
  id: 1, slug: RUBRIC_SLUG, name: "Test Rubric", isActive: true, isArchived: false,
  gradeSpan: null, description: null, displayOrder: 1, target: "TEACHER", subjectAudience: "ALL",
}];

const MOCK_DASHBOARD_DATA: DashboardData = {
  rubricSet: { id: 1, slug: RUBRIC_SLUG, name: "Test Rubric", gradeSpan: null, target: "TEACHER" },
  schoolGradeSpan: null,
  categories: [{ id: "cat1", label: "Instruction", domains: [{ id: "d1", label: "Planning" }] }],
  teachers: [{
    /* The server sends the same value in both fields — see the dashboard route,
       which maps `id: p.employeeId`. The link carries employeeId either way. */
    id: EMPLOYEE_ID, employeeId: EMPLOYEE_ID,
    name: "Samra Djokovic", firstName: "Samra", lastName: "Djokovic",
    subject: "English", gradeLevel: ["11"],
    observations: [{ id: "obs-1", date: "2026-07-01", scores: { d1: 1 }, observer: "Test Observer" }],
  }],
};

function setUrl(search: string) {
  window.history.replaceState(null, "", "/" + search);
}

/* Real replaceState, plus the notification wouter would give us. */
const realReplaceState = window.history.replaceState.bind(window.history);

describe("Dashboard — /?teacher= deep link", () => {
  beforeEach(() => {
    localStorage.setItem("catalyst:activeRubricSet", RUBRIC_SLUG);
    (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;

    window.history.replaceState = ((...args: Parameters<typeof realReplaceState>) => {
      realReplaceState(...args);
      window.dispatchEvent(new Event("catalyst:test-navigate"));
    }) as typeof window.history.replaceState;

    mockFetchRubricSets.mockResolvedValue(MOCK_RUBRIC_SETS);
    mockFetchMyLatestRubricSlug.mockResolvedValue(RUBRIC_SLUG);
  });

  afterEach(() => {
    window.history.replaceState = realReplaceState;
    setUrl("");
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("opens the teacher's profile when the teacher list arrives after mount", async () => {
    /* Cold: the dashboard data lands a tick late, exactly as it does on a real
       page load arriving from the Action Center. */
    mockFetchDashboard.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(MOCK_DASHBOARD_DATA), 50)),
    );

    setUrl(`?teacher=${EMPLOYEE_ID}`);

    const Dashboard = (await import("@/components/Dashboard")).default;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });

    render(
      <QueryClientProvider client={qc}>
        <Dashboard />
      </QueryClientProvider>,
    );

    await waitFor(
      () => expect(screen.getByTestId("profile-overlay").textContent).toBe("Samra Djokovic"),
      { timeout: 4000 },
    );
  });

  it("keeps ?teacher= in the URL while the data is still loading", async () => {
    mockFetchDashboard.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(MOCK_DASHBOARD_DATA), 50)),
    );

    setUrl(`?teacher=${EMPLOYEE_ID}`);

    const Dashboard = (await import("@/components/Dashboard")).default;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });

    render(
      <QueryClientProvider client={qc}>
        <Dashboard />
      </QueryClientProvider>,
    );

    /* The parameter must survive the first URL rewrite. Losing it here is the
       bug: nothing downstream can recover an id that is no longer anywhere. */
    await waitFor(() => expect(mockFetchDashboard).toHaveBeenCalled());
    expect(window.location.search).toContain(`teacher=${EMPLOYEE_ID}`);
  });
});
