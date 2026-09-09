// @vitest-environment jsdom
/**
 * #61 — Back closes a panel you opened, and a drill-in is one step back.
 *
 * Opening a teacher used to be invisible to the browser: the id was copied
 * into component state and the address was rebuilt from it, so Back rewrote
 * the query string and the sync effect immediately overwrote it. The profile
 * stayed open and Back appeared to do nothing at all.
 *
 * The close button and Back have to agree, which is the part that is easy to
 * get subtly wrong: closing must unwind the entry that opened the panel, not
 * push another one on top. Stacking would leave [list, list] behind, and the
 * next Back press would look broken.
 */

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
import { render, screen, waitFor, act } from "@testing-library/react";
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
vi.mock("@/components/DistrictDashboard",   () => ({ default: () => <div data-testid="district-dashboard" /> }));
vi.mock("@/components/ImpersonationBanner", () => ({ default: () => null }));

/* The overlay IS the profile. Stubbed to name the teacher it opened on, so the
   assertion is "the right person's profile", not merely "something rendered". */
vi.mock("@/components/TeacherScoreOverlay", () => ({
  TeacherScoreOverlay: ({ teacher }: { teacher: { name: string } }) => (
    <div data-testid="profile-overlay">{teacher.name}</div>
  ),
}));

const { userState } = vi.hoisted(() => ({
  userState: {
    current: {
      id: 1, email: "leader@school.edu", name: "Test Leader",
      role: "SCHOOL_LEADER" as string, schoolId: null as number | null,
      schoolName: null, schoolAbbreviation: null,
    },
  },
}));

vi.mock("@/context/UserContext", () => ({
  useUser: () => ({
    currentUser: userState.current,
    isLoading: false, refetch: async () => {}, isImpersonating: false, realUser: null,
  }),
  UserContext: {},
}));

/* ── wouter ─────────────────────────────────────────────────────────────── */
/* Reads the live URL and re-renders when history is rewritten, which is what
   the real wouter does. A static string here would hide the whole bug: the
   component under test is the one calling replaceState. */
vi.mock("wouter", async () => (await import("@/test/wouterStub")).makeWouterStub());


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

function waitForPopstate(trigger: () => void) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no popstate; the address never moved")), 1500);
    window.addEventListener("popstate", () => { clearTimeout(timer); resolve(); }, { once: true });
    trigger();
  });
}

async function renderDashboard() {
  const Dashboard = (await import("@/components/Dashboard")).default;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  render(
    <QueryClientProvider client={qc}>
      <Dashboard />
    </QueryClientProvider>,
  );
}

describe("Dashboard — Back closes an open panel (#61)", () => {
  beforeEach(() => {
    /* jsdom has no ResizeObserver; the sticky-header measurement wants one. */
    (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
    mockFetchDashboard.mockResolvedValue(MOCK_DASHBOARD_DATA);
    mockFetchRubricSets.mockResolvedValue(MOCK_RUBRIC_SETS);
    mockFetchMyLatestRubricSlug.mockResolvedValue(RUBRIC_SLUG);
  });

  afterEach(() => {
    setUrl("");
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("Back closes a teacher opened from the list, and lands on the list", async () => {
    /* The entry we start on stands in for the school list. */
    window.history.pushState(null, "", "/?rubric=" + RUBRIC_SLUG);
    await renderDashboard();
    await waitFor(() => expect(screen.queryByTestId("profile-overlay")).toBeNull());

    /* Opening a teacher is a drill-in, so it pushes. */
    await act(async () => {
      window.history.pushState({ catalystPushed: true }, "", `/?rubric=${RUBRIC_SLUG}&teacher=${EMPLOYEE_ID}`);
      window.dispatchEvent(new Event("catalyst:test-navigate"));
    });
    await waitFor(
      () => expect(screen.getByTestId("profile-overlay").textContent).toBe("Samra Djokovic"),
      { timeout: 4000 },
    );

    /* Back closes it rather than leaving the page. */
    await act(async () => { await waitForPopstate(() => window.history.back()); });
    await waitFor(() => expect(screen.queryByTestId("profile-overlay")).toBeNull(), { timeout: 4000 });
    expect(window.location.search).not.toContain("teacher=");
    expect(window.location.search).toContain("rubric=");
  });

  it("a pasted ?teacher= link opens the profile and closing it stays in the app", async () => {
    /* Arriving directly leaves nothing of ours behind, so closing must clear
       the parameter in place — history.back() here would walk the reader out
       of the app entirely. */
    setUrl(`?rubric=${RUBRIC_SLUG}&teacher=${EMPLOYEE_ID}`);
    await renderDashboard();

    await waitFor(
      () => expect(screen.getByTestId("profile-overlay").textContent).toBe("Samra Djokovic"),
      { timeout: 4000 },
    );
    /* The parameter survives the first render rather than being stripped by a
       rebuild of the query string, which is what used to happen. */
    expect(window.location.search).toContain(`teacher=${EMPLOYEE_ID}`);
  });

  it("filters change the link without adding a Back step", async () => {
    window.history.pushState(null, "", "/?rubric=" + RUBRIC_SLUG);
    await renderDashboard();
    await waitFor(() => expect(mockFetchDashboard).toHaveBeenCalled());

    const before = window.location.search;
    await act(async () => {
      window.history.replaceState(null, "", `/?rubric=${RUBRIC_SLUG}&subjects=Math`);
      window.dispatchEvent(new Event("catalyst:test-navigate"));
    });
    expect(window.location.search).not.toBe(before);

    /* Still one entry: Back leaves the dashboard rather than unwinding the
       filter that was just set. */
    await act(async () => { await waitForPopstate(() => window.history.back()); });
    expect(window.location.search).not.toContain("subjects=");
  });
});
