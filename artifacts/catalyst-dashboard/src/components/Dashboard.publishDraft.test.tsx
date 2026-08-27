// @vitest-environment jsdom
/**
 * Regression guard: publishing a draft must send the observation's facts, not
 * just its wording.
 *
 * Failure mode prevented — and observed in production. The publish PUT carried
 * only strengths, growth areas and scores. The walkthrough toggle reached the
 * server through one route alone: the draft autosave, which fires two seconds
 * after a change and is cancelled outright by clicking Save. The toggle sits
 * beside the Save button, so flipping it and saving promptly — the obvious
 * thing to do — published an ordinary observation. Two walkthroughs at
 * Brownsville North were lost this way, and editing them afterwards fixed them
 * because the edit path always sent the flag.
 *
 * Nearly every observation goes out through this branch: a draft exists after
 * two seconds of typing, so the straight-to-published branch is close to
 * unreachable in practice. That is what made a timing bug look constant.
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/lib/queryKeys";
import type { Score } from "@workspace/api-types";

/* ── Hoisted: capture the onSubmit the Dashboard hands the modal ─────────── */
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

/* ── Fixtures ────────────────────────────────────────────────────────────── */
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

async function renderDashboard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  qc.setQueryData(QUERY_KEYS.rubricSets, MOCK_RUBRIC_SETS);
  qc.setQueryData(QUERY_KEYS.myLatestRubricSlug, "q1-test");
  qc.setQueryData(["dashboard", "q1-test", 5, false], MOCK_DASHBOARD_DATA);

  const Dashboard = (await import("@/components/Dashboard")).default;
  render(
    React.createElement(QueryClientProvider, { client: qc },
      React.createElement(Dashboard)),
  );
  await waitFor(() => expect(captured.onSubmit).not.toBeNull(), { timeout: 3000 });
}

const SCORES = { "d-1": 0.5 } as unknown as Record<string, Score>;

/* ── Tests ───────────────────────────────────────────────────────────────── */
describe("Dashboard — publishing a draft observation", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
    captured.onSubmit = null;
    localStorage.setItem("catalyst:activeRubricSet", "q1-test");
    mockFetchDashboard.mockResolvedValue(MOCK_DASHBOARD_DATA);
    mockFetchRubricSets.mockResolvedValue(MOCK_RUBRIC_SETS);
    mockFetchMyLatestRubricSlug.mockResolvedValue("q1-test");
    mockUpdateObservation.mockResolvedValue({ id: "draft-1" });
    mockCreateObservation.mockResolvedValue({ id: "obs-new" });
  });

  afterEach(() => { localStorage.clear(); vi.clearAllMocks(); });

  it("sends the walkthrough flag when publishing a draft", async () => {
    await renderDashboard();

    await act(async () => {
      await captured.onSubmit!(
        "teacher-1", "2026-08-20", SCORES, "Glows", "Grows",
        /* isWalkthrough */ true, "09:15", "Algebra I", "draft-1",
      );
    });

    expect(mockUpdateObservation).toHaveBeenCalledWith(
      "draft-1",
      expect.objectContaining({ isWalkthrough: true, status: "published" }),
    );
  });

  it("sends a walkthrough flag that was turned back off", async () => {
    /* Not just the true case: the toggle has to be able to travel in both
       directions, or turning it off before saving would silently keep it on. */
    await renderDashboard();

    await act(async () => {
      await captured.onSubmit!(
        "teacher-1", "2026-08-20", SCORES, "Glows", "Grows",
        false, "09:15", "Algebra I", "draft-1",
      );
    });

    expect(mockUpdateObservation).toHaveBeenCalledWith(
      "draft-1",
      expect.objectContaining({ isWalkthrough: false }),
    );
  });

  it("sends the date, time and course when publishing a draft", async () => {
    /* Same root cause, same fix: these were only ever written by the POST that
       first created the draft, so correcting any of them and saving lost the
       correction. */
    await renderDashboard();

    await act(async () => {
      await captured.onSubmit!(
        "teacher-1", "2026-08-20", SCORES, "Glows", "Grows",
        true, "09:15", "Algebra I", "draft-1",
      );
    });

    expect(mockUpdateObservation).toHaveBeenCalledWith(
      "draft-1",
      expect.objectContaining({ date: "2026-08-20", time: "09:15", course: "Algebra I" }),
    );
  });

  it("still sends the walkthrough flag when there is no draft to publish", async () => {
    await renderDashboard();

    await act(async () => {
      await captured.onSubmit!(
        "teacher-1", "2026-08-20", SCORES, "Glows", "Grows",
        true, "09:15", "Algebra I", undefined,
      );
    });

    expect(mockCreateObservation).toHaveBeenCalledWith(
      expect.objectContaining({ isWalkthrough: true, status: "published" }),
    );
  });
});
