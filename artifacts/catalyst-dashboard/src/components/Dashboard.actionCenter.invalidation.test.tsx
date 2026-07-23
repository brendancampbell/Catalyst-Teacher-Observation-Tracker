// @vitest-environment jsdom
/**
 * Regression guard: editing or deleting an observation from the Dashboard
 * must immediately invalidate the overdueActionSteps and per-teacher
 * actionSteps queries so the Action Center reflects the change without
 * a page reload.
 *
 * Failure mode prevented: a future refactor removes or misspells the
 * invalidateQueries calls inside handleUpdateObs or handleDeleteObs,
 * causing stale overdue entries or per-teacher action-step counts to persist.
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/lib/queryKeys";
import type { Observation } from "@/data/dummy";

/* ── Hoisted: capture slots for DrillDownModal callbacks ─────────────────── */
const {
  capturedCallbacks,
  mockUpdateObservation,
  mockDeleteObservation,
  mockFetchDashboard,
  mockFetchRubricSets,
  mockFetchMyLatestRubricSlug,
} = vi.hoisted(() => ({
  capturedCallbacks: {
    onUpdateObs: null as ((teacherId: string, obs: Observation) => Promise<void>) | null,
    onDeleteObs: null as ((teacherId: string, obsId: string) => Promise<void>) | null,
  },
  mockUpdateObservation:       vi.fn(),
  mockDeleteObservation:       vi.fn(),
  mockFetchDashboard:          vi.fn(),
  mockFetchRubricSets:         vi.fn(),
  mockFetchMyLatestRubricSlug: vi.fn(),
}));

/* ── Mock DrillDownModal — captures onUpdateObs / onDeleteObs on every render */
vi.mock("@/components/DrillDownModal", () => ({
  DrillDownModal: (props: {
    onUpdateObs: (teacherId: string, obs: Observation) => Promise<void>;
    onDeleteObs: (teacherId: string, obsId: string) => Promise<void>;
  }) => {
    capturedCallbacks.onUpdateObs = props.onUpdateObs;
    capturedCallbacks.onDeleteObs = props.onDeleteObs;
    return null;
  },
}));

/* ── Mock @/lib/api ──────────────────────────────────────────────────────── */
vi.mock("@/lib/api", () => ({
  fetchDashboard:          (...a: unknown[]) => mockFetchDashboard(...a),
  fetchRubricSets:         (...a: unknown[]) => mockFetchRubricSets(...a),
  fetchMyLatestRubricSlug: (...a: unknown[]) => mockFetchMyLatestRubricSlug(...a),
  updateObservation:       (...a: unknown[]) => mockUpdateObservation(...a),
  deleteObservation:       (...a: unknown[]) => mockDeleteObservation(...a),
  createObservation:       vi.fn().mockResolvedValue({ id: "new-obs" }),
}));

/* ── Stub heavy sub-components ───────────────────────────────────────────── */
vi.mock("@/components/AppHeader",          () => ({ default: () => null }));
vi.mock("@/components/FilterMultiSelect",  () => ({ FilterMultiSelect: () => null }));
vi.mock("@/components/NewObservationModal",() => ({ NewObservationModal: () => null }));
vi.mock("@/components/TeacherScoreOverlay",() => ({ TeacherScoreOverlay: () => null }));
vi.mock("@/components/DistrictDashboard",  () => ({ default: () => null }));

/* ── Stub UserContext ────────────────────────────────────────────────────── */
vi.mock("@/context/UserContext", () => ({
  useUser: () => ({
    currentUser: {
      id:                 "leader-1",
      email:              "leader@school.edu",
      name:               "Test Leader",
      role:               "SCHOOL_LEADER",
      schoolId:           5,
      schoolName:         "Test School",
      schoolAbbreviation: "TS",
    },
    isLoading:       false,
    refetch:         async () => {},
    isImpersonating: false,
    realUser:        null,
  }),
  UserContext: {},
}));

/* ── Stub wouter ─────────────────────────────────────────────────────────── */
vi.mock("wouter", () => ({
  useSearch:   () => "",
  useLocation: () => ["/", vi.fn()],
  Link:        ({ children }: { children: React.ReactNode }) => children,
}));

/* ── Stub ResizeObserver (not available in jsdom) ────────────────────────── */
class ResizeObserverStub {
  observe()    {}
  unobserve()  {}
  disconnect() {}
}

/* ── Fixtures ────────────────────────────────────────────────────────────── */
const TEACHER_ID = "teacher-1";

const OBSERVATION: Observation = {
  id:          "obs-1",
  date:        "2026-07-01",
  scores:      { "d-1": 0.5 },
  observer:    "Test Leader",
  strengths:   "Good pacing",
  growthAreas: "Ask more questions",
};

const MOCK_RUBRIC_SETS = [
  {
    id:              1,
    slug:            "q1-test",
    name:            "Q1 Test",
    isActive:        true,
    isArchived:      false,
    gradeSpan:       null,
    description:     null,
    displayOrder:    1,
    target:          "TEACHER",
    subjectAudience: "ALL",
  },
];

const MOCK_DASHBOARD_DATA = {
  rubricSet:       { id: 1, slug: "q1-test", name: "Q1 Test", gradeSpan: null, target: "TEACHER" },
  schoolGradeSpan: null,
  categories: [
    {
      id:      "cat-1",
      label:   "Instruction",
      domains: [{ id: "d-1", label: "Planning" }],
    },
  ],
  teachers: [
    {
      id:           TEACHER_ID,
      name:         "Ms. Jane Smith",
      firstName:    "Jane",
      lastName:     "Smith",
      subject:      "Math",
      gradeLevel:   ["9"],
      observations: [OBSERVATION],
    },
  ],
};

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function makeSeededQueryClient() {
  const qc = makeQueryClient();
  qc.setQueryData(QUERY_KEYS.rubricSets,                           MOCK_RUBRIC_SETS);
  qc.setQueryData(QUERY_KEYS.myLatestRubricSlug,                   "q1-test");
  qc.setQueryData(["dashboard", "q1-test", 5, false],             MOCK_DASHBOARD_DATA);
  qc.setQueryData(["dashboard", "q1-test", null, false],          MOCK_DASHBOARD_DATA);
  qc.setQueryData(QUERY_KEYS.overdueActionSteps,                   [{ id: 1, teacherId: TEACHER_ID, text: "Improve wait time", dueDate: "2026-06-01" }]);
  qc.setQueryData([...QUERY_KEYS.actionSteps, TEACHER_ID],        [{ id: 1, text: "Improve wait time", status: "open" }]);
  return qc;
}

function assertKeyInvalidated(
  spy: ReturnType<typeof vi.spyOn>,
  predicate: (key: unknown[] | undefined) => boolean,
  label: string,
) {
  const calls = spy.mock.calls;
  const matched = calls.some((args: unknown[]) => {
    const opts = args[0] as { queryKey?: unknown[] } | undefined;
    return predicate(opts?.queryKey);
  });
  expect(
    matched,
    `Expected queryClient.invalidateQueries to be called with ${label} but calls were: ${JSON.stringify(calls.map((a: unknown[]) => (a[0] as Record<string, unknown>)?.queryKey))}`,
  ).toBe(true);
}

/* ── Tests ───────────────────────────────────────────────────────────────── */
describe("Dashboard — Action Center cache invalidation after edit/delete", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
    capturedCallbacks.onUpdateObs = null;
    capturedCallbacks.onDeleteObs = null;
    localStorage.setItem("catalyst:activeRubricSet", "q1-test");
    mockFetchDashboard.mockResolvedValue(MOCK_DASHBOARD_DATA);
    mockFetchRubricSets.mockResolvedValue(MOCK_RUBRIC_SETS);
    mockFetchMyLatestRubricSlug.mockResolvedValue("q1-test");
    mockUpdateObservation.mockResolvedValue({ ...OBSERVATION, strengths: "Updated strengths" });
    mockDeleteObservation.mockResolvedValue({ ok: true, id: "obs-1" });
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("invalidates overdueActionSteps after editing an observation", async () => {
    const qc = makeSeededQueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const Dashboard = (await import("@/components/Dashboard")).default;

    render(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(Dashboard),
      ),
    );

    /* DrillDownModal is always mounted — wait for callbacks to be captured */
    await waitFor(
      () => expect(capturedCallbacks.onUpdateObs).not.toBeNull(),
      { timeout: 3000 },
    );

    /* Simulate the user saving an edit via DrillDownModal */
    await act(async () => {
      await capturedCallbacks.onUpdateObs!(TEACHER_ID, { ...OBSERVATION, strengths: "Updated" });
    });

    /* Assert overdueActionSteps was invalidated — the core regression guard */
    await waitFor(
      () =>
        assertKeyInvalidated(
          invalidateSpy,
          (key) => Array.isArray(key) && key[0] === QUERY_KEYS.overdueActionSteps[0],
          `queryKey "${QUERY_KEYS.overdueActionSteps[0]}"`,
        ),
      { timeout: 3000 },
    );
  });

  it("invalidates per-teacher actionSteps after editing an observation", async () => {
    const qc = makeSeededQueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const Dashboard = (await import("@/components/Dashboard")).default;

    render(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(Dashboard),
      ),
    );

    await waitFor(
      () => expect(capturedCallbacks.onUpdateObs).not.toBeNull(),
      { timeout: 3000 },
    );

    await act(async () => {
      await capturedCallbacks.onUpdateObs!(TEACHER_ID, { ...OBSERVATION, strengths: "Updated" });
    });

    /* Assert actionSteps[teacherId] was invalidated */
    await waitFor(
      () =>
        assertKeyInvalidated(
          invalidateSpy,
          (key) =>
            Array.isArray(key) &&
            key[0] === QUERY_KEYS.actionSteps[0] &&
            key[1] === TEACHER_ID,
          `queryKey ["${QUERY_KEYS.actionSteps[0]}", "${TEACHER_ID}"]`,
        ),
      { timeout: 3000 },
    );
  });

  it("invalidates overdueActionSteps after deleting an observation", async () => {
    const qc = makeSeededQueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const Dashboard = (await import("@/components/Dashboard")).default;

    render(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(Dashboard),
      ),
    );

    await waitFor(
      () => expect(capturedCallbacks.onDeleteObs).not.toBeNull(),
      { timeout: 3000 },
    );

    /* Simulate the user confirming deletion via DrillDownModal */
    await act(async () => {
      await capturedCallbacks.onDeleteObs!(TEACHER_ID, "obs-1");
    });

    await waitFor(
      () =>
        assertKeyInvalidated(
          invalidateSpy,
          (key) => Array.isArray(key) && key[0] === QUERY_KEYS.overdueActionSteps[0],
          `queryKey "${QUERY_KEYS.overdueActionSteps[0]}"`,
        ),
      { timeout: 3000 },
    );
  });

  it("invalidates per-teacher actionSteps after deleting an observation", async () => {
    const qc = makeSeededQueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const Dashboard = (await import("@/components/Dashboard")).default;

    render(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(Dashboard),
      ),
    );

    await waitFor(
      () => expect(capturedCallbacks.onDeleteObs).not.toBeNull(),
      { timeout: 3000 },
    );

    await act(async () => {
      await capturedCallbacks.onDeleteObs!(TEACHER_ID, "obs-1");
    });

    await waitFor(
      () =>
        assertKeyInvalidated(
          invalidateSpy,
          (key) =>
            Array.isArray(key) &&
            key[0] === QUERY_KEYS.actionSteps[0] &&
            key[1] === TEACHER_ID,
          `queryKey ["${QUERY_KEYS.actionSteps[0]}", "${TEACHER_ID}"]`,
        ),
      { timeout: 3000 },
    );
  });
});
