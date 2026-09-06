// @vitest-environment jsdom
/**
 * Dashboard — a save that fails is reported, not logged and forgotten.
 *
 * Backlog #58, the other half. The form can only keep itself open if it is
 * told the save failed, and handleNewObservation used to catch the error,
 * write it to the console and hand back an empty string — indistinguishable,
 * to the form, from a saved observation. See
 * NewObservationModal.failedSubmit.test.tsx for what the form does with it.
 *
 * The quieter path is here too: with no rubric loaded, submit used to return
 * early, and the window closed without a save ever having been attempted.
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/lib/queryKeys";
import type { Score } from "@workspace/api-types";

const {
  captured,
  mockUpdateObservation,
  mockCreateObservation,
  mockFetchDashboard,
  mockFetchRubricSets,
  mockFetchMyLatestRubricSlug,
} = vi.hoisted(() => ({
  captured: {
    onSubmit: null as
      | ((
          teacherId: string,
          date: string,
          scores: Record<string, unknown>,
          strengths: string,
          growthAreas: string,
          isWalkthrough: boolean,
          time: string,
          course: string,
          draftId?: string,
        ) => Promise<string>)
      | null,
  },
  mockUpdateObservation:       vi.fn(),
  mockCreateObservation:       vi.fn(),
  mockFetchDashboard:          vi.fn(),
  mockFetchRubricSets:         vi.fn(),
  mockFetchMyLatestRubricSlug: vi.fn(),
}));

vi.mock("@/components/NewObservationModal", () => ({
  NewObservationModal: (props: { onSubmit: typeof captured.onSubmit }) => {
    captured.onSubmit = props.onSubmit;
    return null;
  },
}));

vi.mock("@/lib/api", () => ({
  fetchDashboard:          (...a: unknown[]) => mockFetchDashboard(...a),
  fetchRubricSets:         (...a: unknown[]) => mockFetchRubricSets(...a),
  fetchMyLatestRubricSlug: (...a: unknown[]) => mockFetchMyLatestRubricSlug(...a),
  updateObservation:       (...a: unknown[]) => mockUpdateObservation(...a),
  createObservation:       (...a: unknown[]) => mockCreateObservation(...a),
  deleteObservation:       vi.fn(),
}));

vi.mock("@/components/AppHeader",          () => ({ default: () => null }));
vi.mock("@/components/FilterMultiSelect",  () => ({ FilterMultiSelect: () => null }));
vi.mock("@/components/TeacherScoreOverlay",() => ({ TeacherScoreOverlay: () => null }));
vi.mock("@/components/DistrictDashboard",  () => ({ default: () => null }));
vi.mock("@/components/DrillDownModal",     () => ({ DrillDownModal: () => null }));

vi.mock("@/context/UserContext", () => ({
  useUser: () => ({
    currentUser: {
      id: "coach-1", email: "coach@school.edu", name: "Test Coach",
      role: "COACH", schoolId: 5, schoolName: "Test School", schoolAbbreviation: "TS",
    },
    isLoading: false, refetch: async () => {}, isImpersonating: false, realUser: null,
  }),
  UserContext: {},
}));

vi.mock("wouter", () => ({
  useSearch:   () => "",
  useLocation: () => ["/", vi.fn()],
  Link:        ({ children }: { children: React.ReactNode }) => children,
}));

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }

const MOCK_RUBRIC_SETS = [{
  id: 1, slug: "q1-test", name: "Q1 Test", isActive: true, isArchived: false,
  gradeSpan: null, description: null, displayOrder: 1,
  target: "TEACHER", subjectAudience: "ALL",
}];

const MOCK_DASHBOARD_DATA = {
  rubricSet:       { id: 1, slug: "q1-test", name: "Q1 Test", gradeSpan: null, target: "TEACHER" },
  schoolGradeSpan: null,
  categories:      [{ id: "cat-1", label: "Instruction", domains: [{ id: "d-1", label: "Planning" }] }],
  teachers: [{
    id: "teacher-1", name: "Meg Salta", firstName: "Meg", lastName: "Salta",
    subject: "Math", gradeLevel: ["7"], observations: [],
  }],
};

async function renderDashboard(dashboardData: unknown = MOCK_DASHBOARD_DATA) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  qc.setQueryData(QUERY_KEYS.rubricSets, MOCK_RUBRIC_SETS);
  qc.setQueryData(QUERY_KEYS.myLatestRubricSlug, "q1-test");
  qc.setQueryData(["dashboard", "q1-test", 5, false], dashboardData);

  const Dashboard = (await import("@/components/Dashboard")).default;
  render(
    React.createElement(QueryClientProvider, { client: qc },
      React.createElement(Dashboard)),
  );
  await waitFor(() => expect(captured.onSubmit).not.toBeNull(), { timeout: 3000 });
}

const SCORES = { "d-1": 0.5 } as unknown as Record<string, Score>;

function submit(draftId?: string) {
  return captured.onSubmit!(
    "teacher-1", "2026-08-20", SCORES, "Glows", "Grows",
    false, "09:15", "Algebra I", draftId,
  );
}

describe("Dashboard — a save that fails", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
    captured.onSubmit = null;
    localStorage.setItem("catalyst:activeRubricSet", "q1-test");
    mockFetchDashboard.mockResolvedValue(MOCK_DASHBOARD_DATA);
    mockFetchRubricSets.mockResolvedValue(MOCK_RUBRIC_SETS);
    mockFetchMyLatestRubricSlug.mockResolvedValue("q1-test");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => { localStorage.clear(); vi.clearAllMocks(); vi.restoreAllMocks(); });

  it("passes the failure back to the form instead of swallowing it", async () => {
    /* Returning "" here was the bug: the form read it as a saved observation,
       cleared itself and closed. */
    mockCreateObservation.mockRejectedValue(new Error("Network request failed"));
    await renderDashboard();

    await expect(submit()).rejects.toThrow("Network request failed");
  });

  it("passes back a failure to publish an existing draft too", async () => {
    mockUpdateObservation.mockRejectedValue(new Error("Server returned 500"));
    await renderDashboard();

    await expect(submit("draft-1")).rejects.toThrow("Server returned 500");
  });

  it("says so, rather than closing, when there is no rubric to save against", async () => {
    /* The second, quieter path. Submit used to return early with an empty
       string and the window closed, having never attempted a save at all. */
    const noRubric = { ...MOCK_DASHBOARD_DATA, rubricSet: { ...MOCK_DASHBOARD_DATA.rubricSet, id: 0 } };
    await renderDashboard(noRubric);

    await expect(submit()).rejects.toThrow(/rubric is still loading/i);
    expect(mockCreateObservation).not.toHaveBeenCalled();
  });

  it("returns the new observation's id when the save works", async () => {
    mockCreateObservation.mockResolvedValue({ id: "obs-new" });
    await renderDashboard();

    await expect(submit()).resolves.toBe("obs-new");
  });
});
