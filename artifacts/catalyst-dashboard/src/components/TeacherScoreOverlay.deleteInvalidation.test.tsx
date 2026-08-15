// @vitest-environment jsdom
/**
 * Regression guard: editing or deleting an observation from TeacherScoreOverlay
 * must invalidate the overdueActionSteps query AND the per-teacher actionSteps
 * query so that the Action Center reflects the change without a manual refresh.
 *
 * Failure mode prevented: the onDelete / onSave handlers only called
 * invalidateQueries({ queryKey: QUERY_KEYS.dashboard }), leaving Action Center
 * stale if action steps were linked to the affected observation.
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/lib/queryKeys";

/* ── Hoisted mocks ──────────────────────────────────────────────────────── */
const {
  mockDeleteObservation,
  mockUpdateObservation,
  mockFetchActionSteps,
  mockFetchDashboard,
} = vi.hoisted(() => ({
  mockDeleteObservation: vi.fn(),
  mockUpdateObservation: vi.fn(),
  mockFetchActionSteps:  vi.fn(),
  mockFetchDashboard:    vi.fn(),
}));

/* ── @/lib/api ──────────────────────────────────────────────────────────── */
vi.mock("@/lib/api", () => ({
  deleteObservation:  (...a: unknown[]) => mockDeleteObservation(...a),
  updateObservation:  (...a: unknown[]) => mockUpdateObservation(...a),
  fetchActionSteps:   (...a: unknown[]) => mockFetchActionSteps(...a),
  fetchDashboard:     (...a: unknown[]) => mockFetchDashboard(...a),
  masterActionStep:   vi.fn().mockResolvedValue({ ok: true }),
}));

/* ── @/context/UserContext ─────────────────────────────────────────────── */
vi.mock("@/context/UserContext", () => ({
  useUser: () => ({
    currentUser: {
      id:                 "leader-1",
      employeeId:         "emp-leader-1",
      name:               "Test Leader",
      email:              "leader@school.edu",
      role:               "SCHOOL_LEADER",
      schoolId:           5,
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

/* ── ObservationDetailModal ─────────────────────────────────────────────── *
 * Captures the onDelete / onSave callbacks passed by TeacherScoreOverlay and
 * exposes test-only trigger buttons so we can invoke the real handlers.
 * ─────────────────────────────────────────────────────────────────────────── */
vi.mock("@/components/ObservationDetailModal", () => ({
  ObservationDetailModal: ({
    open,
    observation,
    onDelete,
    onSave,
  }: {
    open: boolean;
    observation: { id: string; date: string; scores: Record<string, number>; strengths?: string; growthAreas?: string; observer?: string; isWalkthrough?: boolean; status?: string };
    onDelete?: (id: string) => Promise<void>;
    onSave?:   (obs: typeof observation) => Promise<void>;
  }) => {
    if (!open) return null;
    return React.createElement(
      "div",
      { "data-testid": "obs-detail-modal" },
      onDelete &&
        React.createElement(
          "button",
          { "data-testid": "trigger-delete", onClick: () => onDelete(observation.id) },
          "Trigger Delete",
        ),
      onSave &&
        React.createElement(
          "button",
          { "data-testid": "trigger-save", onClick: () => onSave(observation) },
          "Trigger Save",
        ),
    );
  },
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

/* ── lucide-react ───────────────────────────────────────────────────────── */
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
const OBS_FIXTURE = {
  id:            "obs-1",
  date:          "2026-07-01",
  observer:      "Test Leader",
  scores:        { "d-1": 0.5 as 0 | 0.5 | 1 },
  strengths:     "Good pacing",
  growthAreas:   "More wait time",
  isWalkthrough: false,
  status:        "published" as const,
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
  observations: [OBS_FIXTURE],
};

const RUBRIC_SET = {
  id:              1,
  slug:            "q1-2026",
  name:            "Q1 2026",
  isActive:        true,
  isArchived:      false,
  displayOrder:    1,
  target:          "TEACHER" as const,
  subjectAudience: "ALL" as const,
  gradeSpan:       null,
  description:     null,
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

async function renderOverlay(qc: QueryClient) {
  const { TeacherScoreOverlay } = await import("@/components/TeacherScoreOverlay");
  render(
    React.createElement(
      QueryClientProvider,
      { client: qc },
      React.createElement(TeacherScoreOverlay, {
        teacher:           TEACHER_FIXTURE,
        onBack:            vi.fn(),
        onNewObs:          vi.fn(),
        rubricSets:        [RUBRIC_SET],
        initialRubricSet:  "q1-2026",
        initialCategories: [CATEGORY],
        schoolId:          5,
      }),
    ),
  );
}

/** Click the ObservationCard to open the detail modal. */
async function openObsModal() {
  const card = screen.getByRole("button", { name: /view observation from 2026-07-01/i });
  fireEvent.click(card);
  await screen.findByTestId("obs-detail-modal", {}, { timeout: 3_000 });
}

/* ── Tests ──────────────────────────────────────────────────────────────── */
describe("TeacherScoreOverlay — observation delete/edit cache invalidation", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
    mockFetchActionSteps.mockResolvedValue([]);
    mockDeleteObservation.mockResolvedValue(undefined);
    mockUpdateObservation.mockImplementation((_id: string, updates: unknown) =>
      Promise.resolve({ ...OBS_FIXTURE, ...(updates as object) }),
    );
    mockFetchDashboard.mockResolvedValue({
      rubricSet:       { id: 1, slug: "q1-2026", name: "Q1 2026", gradeSpan: null, target: "TEACHER" },
      schoolGradeSpan: null,
      categories:      [CATEGORY],
      teachers:        [TEACHER_FIXTURE],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /* ── Delete path ──────────────────────────────────────────────────────── */

  it("invalidates overdueActionSteps after deleting an observation", async () => {
    const qc = makeQueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    await renderOverlay(qc);
    await openObsModal();

    await act(async () => {
      fireEvent.click(screen.getByTestId("trigger-delete"));
    });

    await waitFor(
      () => {
        const calls = invalidateSpy.mock.calls;
        const hit = calls.some((args) => {
          const key = (args[0] as { queryKey?: unknown[] } | undefined)?.queryKey;
          return Array.isArray(key) && key[0] === QUERY_KEYS.overdueActionSteps[0];
        });
        expect(
          hit,
          `Expected invalidateQueries to be called with "${QUERY_KEYS.overdueActionSteps[0]}" ` +
          `after delete, but calls were: ${JSON.stringify(calls.map((a) => a[0]))}`,
        ).toBe(true);
      },
      { timeout: 3_000 },
    );
  });

  it("invalidates per-teacher actionSteps after deleting an observation", async () => {
    const qc = makeQueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    await renderOverlay(qc);
    await openObsModal();

    await act(async () => {
      fireEvent.click(screen.getByTestId("trigger-delete"));
    });

    await waitFor(
      () => {
        const calls = invalidateSpy.mock.calls;
        const hit = calls.some((args) => {
          const key = (args[0] as { queryKey?: unknown[] } | undefined)?.queryKey;
          return (
            Array.isArray(key) &&
            key[0] === QUERY_KEYS.actionSteps[0] &&
            key[1] === TEACHER_FIXTURE.employeeId
          );
        });
        expect(
          hit,
          `Expected invalidateQueries to be called with ` +
          `["${QUERY_KEYS.actionSteps[0]}", "${TEACHER_FIXTURE.employeeId}"] ` +
          `after delete, but calls were: ${JSON.stringify(calls.map((a) => a[0]))}`,
        ).toBe(true);
      },
      { timeout: 3_000 },
    );
  });

  /* ── Edit path ────────────────────────────────────────────────────────── */

  it("invalidates overdueActionSteps after editing an observation", async () => {
    const qc = makeQueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    await renderOverlay(qc);
    await openObsModal();

    await act(async () => {
      fireEvent.click(screen.getByTestId("trigger-save"));
    });

    await waitFor(
      () => {
        const calls = invalidateSpy.mock.calls;
        const hit = calls.some((args) => {
          const key = (args[0] as { queryKey?: unknown[] } | undefined)?.queryKey;
          return Array.isArray(key) && key[0] === QUERY_KEYS.overdueActionSteps[0];
        });
        expect(
          hit,
          `Expected invalidateQueries to be called with "${QUERY_KEYS.overdueActionSteps[0]}" ` +
          `after edit/save, but calls were: ${JSON.stringify(calls.map((a) => a[0]))}`,
        ).toBe(true);
      },
      { timeout: 3_000 },
    );
  });

  it("invalidates per-teacher actionSteps after editing an observation", async () => {
    const qc = makeQueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    await renderOverlay(qc);
    await openObsModal();

    await act(async () => {
      fireEvent.click(screen.getByTestId("trigger-save"));
    });

    await waitFor(
      () => {
        const calls = invalidateSpy.mock.calls;
        const hit = calls.some((args) => {
          const key = (args[0] as { queryKey?: unknown[] } | undefined)?.queryKey;
          return (
            Array.isArray(key) &&
            key[0] === QUERY_KEYS.actionSteps[0] &&
            key[1] === TEACHER_FIXTURE.employeeId
          );
        });
        expect(
          hit,
          `Expected invalidateQueries to be called with ` +
          `["${QUERY_KEYS.actionSteps[0]}", "${TEACHER_FIXTURE.employeeId}"] ` +
          `after edit/save, but calls were: ${JSON.stringify(calls.map((a) => a[0]))}`,
        ).toBe(true);
      },
      { timeout: 3_000 },
    );
  });
});
