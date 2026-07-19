// @vitest-environment jsdom
/**
 * Regression guard: mastering a step from the Dashboard TeacherProfile
 * component must immediately invalidate the overdueActionSteps query so that
 * the Action Center reflects the change without a manual page refresh.
 *
 * Failure mode prevented: a future refactor removes or misspells the
 * queryClient.invalidateQueries({ queryKey: QUERY_KEYS.overdueActionSteps })
 * call inside handleMasterStep, causing stale "Overdue" entries to persist.
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/lib/queryKeys";

/* ── Hoisted mocks ──────────────────────────────────────────────────────── */
const {
  mockFetchActionSteps,
  mockMasterActionStep,
  mockFetchDashboard,
} = vi.hoisted(() => ({
  mockFetchActionSteps:  vi.fn(),
  mockMasterActionStep:  vi.fn(),
  mockFetchDashboard:    vi.fn(),
}));

/* ── @/lib/api ──────────────────────────────────────────────────────────── */
vi.mock("@/lib/api", () => ({
  fetchActionSteps:   (...a: unknown[]) => mockFetchActionSteps(...a),
  masterActionStep:   (...a: unknown[]) => mockMasterActionStep(...a),
  fetchDashboard:     (...a: unknown[]) => mockFetchDashboard(...a),
  updateObservation:  vi.fn().mockResolvedValue({}),
  deleteObservation:  vi.fn().mockResolvedValue(undefined),
}));

/* ── @/context/UserContext ─────────────────────────────────────────────── */
vi.mock("@/context/UserContext", () => ({
  useUser: () => ({
    currentUser: {
      id:                "leader-1",
      employeeId:        "emp-leader-1",
      name:              "Test Leader",
      email:             "leader@school.edu",
      role:              "SCHOOL_LEADER",
      schoolId:          5,
      schoolAbbreviation: "TS",
    },
    isLoading:       false,
    refetch:         async () => {},
    isImpersonating: false,
    realUser:        null,
  }),
  UserContext: {},
}));

/* ── AppHeader ──────────────────────────────────────────────────────────── */
vi.mock("@/components/AppHeader", () => ({ default: () => null }));

/* ── ObservationDetailModal ─────────────────────────────────────────────── */
vi.mock("@/components/ObservationDetailModal", () => ({
  ObservationDetailModal: () => null,
}));

/* ── RichTextDisplay ────────────────────────────────────────────────────── */
vi.mock("@/components/RichTextDisplay", () => ({
  RichTextDisplay: ({ content }: { content?: string }) =>
    React.createElement("div", { "data-testid": "rich-text" }, content ?? ""),
}));

/* ── ScoreCell helpers ──────────────────────────────────────────────────── */
vi.mock("@/components/ScoreCell", () => ({
  getScoreColor:      () => "",
  getScoreColorExact: () => "",
  default:            () => null,
}));

/* ── use-toast ──────────────────────────────────────────────────────────── */
vi.mock("@/hooks/use-toast", () => ({
  toast:    vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

/* ── lucide-react: stub every icon the component imports ────────────────── */
vi.mock("lucide-react", () => {
  const Icon = () => null;
  return {
    TrendingUp:    Icon,
    TrendingDown:  Icon,
    Minus:         Icon,
    CalendarDays:  Icon,
    BookOpen:      Icon,
    Star:          Icon,
    Plus:          Icon,
    School:        Icon,
    User:          Icon,
    CheckCircle2:  Icon,
    Clock:         Icon,
    AlertCircle:   Icon,
    X:             Icon,
    Loader2:       Icon,
  };
});

/* ── ResizeObserver ─────────────────────────────────────────────────────── */
class ResizeObserverStub {
  observe()    {}
  unobserve()  {}
  disconnect() {}
}

/* ── Fixtures ───────────────────────────────────────────────────────────── */
const OPEN_STEP = {
  id:           1,
  status:       "open" as const,
  text:         "Improve wait time after questions",
  dueDate:      "2099-12-31",
  createdAt:    "2026-07-01T00:00:00.000Z",
  assignedByName: "Test Leader",
  masteredAt:   undefined,
  masteredByName: undefined,
  assignedDuringObservationId: undefined,
  masteredDuringObservationId: undefined,
};

const TEACHER_FIXTURE = {
  id:           "teacher-1",
  name:         "Ms. Jane Smith",
  firstName:    "Jane",
  lastName:     "Smith",
  employeeId:   "emp-teacher-1",
  email:        "jane@school.edu",
  subject:      "Math",
  gradeLevel:   ["9"],
  observations: [],
};

const RUBRIC_SET = {
  id:             1,
  slug:           "q1-2026",
  name:           "Q1 2026",
  isActive:       true,
  isArchived:     false,
  displayOrder:   1,
  target:         "TEACHER" as const,
  subjectAudience: "ALL" as const,
  gradeSpan:      null,
  description:    null,
};

const CATEGORY = {
  id:      "cat-1",
  label:   "Instruction",
  domains: [{ id: "d-1", label: "Planning" }],
};

/* ── Helpers ────────────────────────────────────────────────────────────── */
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

/* ── Tests ──────────────────────────────────────────────────────────────── */
describe("TeacherProfile component — handleMasterStep cache invalidation", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
    mockFetchActionSteps.mockResolvedValue([OPEN_STEP]);
    mockMasterActionStep.mockResolvedValue({ ok: true });
    mockFetchDashboard.mockResolvedValue({
      rubricSet: { id: 1, slug: "q1-2026", name: "Q1 2026", gradeSpan: null, target: "TEACHER" },
      schoolGradeSpan: null,
      categories: [CATEGORY],
      teachers:   [TEACHER_FIXTURE],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("invalidates overdueActionSteps query after mastering a step", async () => {
    const qc = makeQueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const { TeacherProfile } = await import("@/components/TeacherProfile");

    render(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(TeacherProfile, {
          teacher:            TEACHER_FIXTURE,
          onBack:             vi.fn(),
          onNewObs:           vi.fn(),
          rubricSets:         [RUBRIC_SET],
          initialRubricSet:   "q1-2026",
          initialCategories:  [CATEGORY],
          schoolId:           5,
        }),
      ),
    );

    /* Wait for action steps to load (fetchActionSteps resolves) */
    await waitFor(
      () => expect(mockFetchActionSteps).toHaveBeenCalledWith("emp-teacher-1"),
      { timeout: 3000 },
    );

    /* Open the Action Steps drawer by clicking the ActionStepsCard */
    const card = screen.getByRole("button", { name: /open action steps/i });
    fireEvent.click(card);

    /* Wait for the "Mark Mastered" button to appear in the drawer */
    const masterBtn = await screen.findByText("Mark Mastered", {}, { timeout: 3000 });

    /* Click "Mark Mastered" */
    await act(async () => {
      fireEvent.click(masterBtn);
    });

    /* Assert masterActionStep API was called with the correct step id */
    expect(mockMasterActionStep).toHaveBeenCalledWith(OPEN_STEP.id);

    /* Assert overdueActionSteps was invalidated — the core regression guard */
    await waitFor(
      () => {
        const calls = invalidateSpy.mock.calls;
        const invalidatedOverdue = calls.some(
          (args) => {
            const opts = args[0] as { queryKey?: unknown[] } | undefined;
            const key = opts?.queryKey;
            return Array.isArray(key) && key[0] === QUERY_KEYS.overdueActionSteps[0];
          },
        );
        expect(
          invalidatedOverdue,
          `Expected queryClient.invalidateQueries to be called with queryKey "${QUERY_KEYS.overdueActionSteps[0]}" ` +
          `but calls were: ${JSON.stringify(calls.map((a) => a[0]))}`,
        ).toBe(true);
      },
      { timeout: 3000 },
    );
  });

  it("also invalidates actionSteps query for the specific teacher after mastering", async () => {
    const qc = makeQueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const { TeacherProfile } = await import("@/components/TeacherProfile");

    render(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(TeacherProfile, {
          teacher:            TEACHER_FIXTURE,
          onBack:             vi.fn(),
          onNewObs:           vi.fn(),
          rubricSets:         [RUBRIC_SET],
          initialRubricSet:   "q1-2026",
          initialCategories:  [CATEGORY],
          schoolId:           5,
        }),
      ),
    );

    await waitFor(
      () => expect(mockFetchActionSteps).toHaveBeenCalledWith("emp-teacher-1"),
      { timeout: 3000 },
    );

    const card = screen.getByRole("button", { name: /open action steps/i });
    fireEvent.click(card);

    const masterBtn = await screen.findByText("Mark Mastered", {}, { timeout: 3000 });

    await act(async () => {
      fireEvent.click(masterBtn);
    });

    await waitFor(
      () => {
        const calls = invalidateSpy.mock.calls;
        const invalidatedActionSteps = calls.some(
          (args) => {
            const opts = args[0] as { queryKey?: unknown[] } | undefined;
            const key = opts?.queryKey;
            return (
              Array.isArray(key) &&
              key[0] === QUERY_KEYS.actionSteps[0] &&
              key[1] === TEACHER_FIXTURE.employeeId
            );
          },
        );
        expect(
          invalidatedActionSteps,
          `Expected queryClient.invalidateQueries to be called with queryKey ` +
          `["${QUERY_KEYS.actionSteps[0]}", "${TEACHER_FIXTURE.employeeId}"] ` +
          `but calls were: ${JSON.stringify(calls.map((a) => a[0]))}`,
        ).toBe(true);
      },
      { timeout: 3000 },
    );
  });

  it("updates local state optimistically — step no longer appears as open after mastering", async () => {
    const qc = makeQueryClient();

    const { TeacherProfile } = await import("@/components/TeacherProfile");

    render(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(TeacherProfile, {
          teacher:            TEACHER_FIXTURE,
          onBack:             vi.fn(),
          onNewObs:           vi.fn(),
          rubricSets:         [RUBRIC_SET],
          initialRubricSet:   "q1-2026",
          initialCategories:  [CATEGORY],
          schoolId:           5,
        }),
      ),
    );

    /* Open drawer then wait for the "Mark Mastered" button — proves steps loaded */
    fireEvent.click(screen.getByRole("button", { name: /open action steps/i }));

    const masterBtn = await screen.findByText("Mark Mastered", {}, { timeout: 5000 });

    await act(async () => {
      fireEvent.click(masterBtn);
    });

    /* After mastering, "Mark Mastered" button should disappear from open section */
    await waitFor(
      () => expect(screen.queryByText("Mark Mastered")).toBeNull(),
      { timeout: 3000 },
    );
  });
});
