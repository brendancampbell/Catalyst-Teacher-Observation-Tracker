// @vitest-environment jsdom
/**
 * Drafts page — action-step forwarding regression test
 *
 * Verifies that handleSubmitNew (and handleSubmitResumed) correctly forward
 * newActionStep and masterActionStepId into createObservation / updateObservation
 * so action-step data is never silently dropped when submitting from the Drafts page.
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/* ── wouter ── */
vi.mock("wouter", () => ({
  useLocation: () => ["/drafts", vi.fn()],
  useSearch:   () => "",
}));

/* ── UserContext ── */
vi.mock("@/context/UserContext", () => ({
  useUser: () => ({
    currentUser: {
      id:                "coach-1",
      employeeId:        "emp-coach-1",
      name:              "Test Coach",
      email:             "coach@school.edu",
      role:              "COACH",
      schoolId:          42,
      schoolAbbreviation: null,
    },
  }),
}));

/* ── API mocks ── */
const mockCreate       = vi.fn();
const mockUpdate       = vi.fn();
const mockFetchDrafts  = vi.fn();
const mockFetchSlug    = vi.fn();
const mockFetchDash    = vi.fn();

vi.mock("@/lib/api", () => ({
  createObservation:      (...a: unknown[]) => mockCreate(...a),
  updateObservation:      (...a: unknown[]) => mockUpdate(...a),
  deleteObservation:      vi.fn().mockResolvedValue(undefined),
  fetchMyDrafts:          (...a: unknown[]) => mockFetchDrafts(...a),
  fetchMyLatestRubricSlug: (...a: unknown[]) => mockFetchSlug(...a),
  fetchDashboard:         (...a: unknown[]) => mockFetchDash(...a),
}));

/* ── AppHeader: expose a button that triggers onAddObservation ── */
vi.mock("@/components/AppHeader", () => ({
  default: ({ onAddObservation }: { onAddObservation?: () => void }) =>
    React.createElement("button", {
      "data-testid": "open-new-obs",
      type:          "button",
      onClick:       onAddObservation,
    }, "+ New Observation"),
}));

/* ── NewObservationModal: capture onSubmit; render sentinel when open ── */
let capturedOnSubmit: ((...args: unknown[]) => Promise<string>) | null = null;

vi.mock("@/components/NewObservationModal", () => ({
  NewObservationModal: ({
    onSubmit,
    open,
  }: {
    onSubmit: (...a: unknown[]) => Promise<string>;
    open: boolean;
  }) => {
    capturedOnSubmit = onSubmit;
    return open
      ? React.createElement("div", { "data-testid": "modal-open" })
      : null;
  },
}));

/* ── Lucide icons ── */
vi.mock("lucide-react", () => ({
  FileEdit:    () => null,
  Trash2:      () => null,
  RotateCcw:   () => null,
  FileX:       () => null,
  Loader2:     () => null,
  CheckSquare: () => null,
  Square:      () => null,
  ChevronDown: () => null,
}));

/* ── Toast ── */
vi.mock("@/hooks/use-toast", () => ({
  toast:    () => {},
  useToast: () => ({ toast: () => {} }),
}));

/* ── safeReturnTo ── */
vi.mock("@/lib/safeReturnTo", () => ({
  safeReturnTo: (_u: unknown, fb: string) => fb,
}));

/* ── Fixtures ── */
const DASHBOARD_STUB = {
  teachers:   [],
  categories: [
    { id: "cat-1", label: "Instruction", domains: [{ id: "d-1", label: "Planning" }] },
  ],
  rubricSet: { id: 7, slug: "Q1", name: "Q1 2026" },
};

const DRAFT_STUB = {
  id:                  "draft-abc",
  observedEmployeeId:  "teacher-1",
  teacherName:         "Ms. Smith",
  date:                "2026-07-01",
  scores:              {},
  strengths:           "",
  growthAreas:         "",
  isWalkthrough:       false,
  status:              "draft",
  rubricSetId:         7,
  rubricSetSlug:       "Q1",
  rubricSetName:       "Q1 2026",
  course:              null,
  time:                null,
  schoolYearId:        null,
};

function makeQC() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

/* ================================================================== */
/* handleSubmitNew forwards newActionStep into createObservation       */
/* ================================================================== */
describe("Drafts page — handleSubmitNew forwards action-step data", () => {
  beforeEach(() => {
    capturedOnSubmit = null;
    mockFetchDrafts.mockResolvedValue([]);
    mockFetchSlug.mockResolvedValue("Q1");
    mockFetchDash.mockResolvedValue(DASHBOARD_STUB);
    mockCreate.mockResolvedValue({ id: "obs-new" });
    mockUpdate.mockResolvedValue({ id: "obs-upd" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes newActionStep into createObservation when submitting a new observation", async () => {
    const { default: DraftsPage } = await import("@/pages/drafts");
    const qc = makeQC();

    render(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(DraftsPage),
      ),
    );

    /* Open the new-observation modal */
    fireEvent.click(screen.getByTestId("open-new-obs"));

    /* Wait for fetchSlug + fetchDashboard to resolve and modal to open */
    await waitFor(
      () => expect(screen.getByTestId("modal-open")).toBeTruthy(),
      { timeout: 2000 },
    );

    expect(capturedOnSubmit).not.toBeNull();

    const actionStep = { text: "Work on pacing", dueDate: "2026-08-01" };

    /* Simulate the modal calling onSubmit with all 11 positional args */
    await act(async () => {
      await capturedOnSubmit!(
        "teacher-1",    // teacherId
        "2026-07-19",   // date
        { "d-1": 1 },   // scores
        "<p>Great</p>", // strengths
        "<p>Pacing</p>",// growthAreas
        false,          // isWalkthrough
        "09:00",        // time
        "Algebra I",    // course
        undefined,      // draftId  (9th param — not used by handleSubmitNew)
        actionStep,     // newActionStep  ← the value under test
        undefined,      // masterActionStepId
      );
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    const payload = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.newActionStep).toEqual(actionStep);
  });

  it("passes masterActionStepId into createObservation when submitting a new observation", async () => {
    const { default: DraftsPage } = await import("@/pages/drafts");
    const qc = makeQC();

    render(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(DraftsPage),
      ),
    );

    fireEvent.click(screen.getByTestId("open-new-obs"));

    await waitFor(
      () => expect(screen.getByTestId("modal-open")).toBeTruthy(),
      { timeout: 2000 },
    );

    expect(capturedOnSubmit).not.toBeNull();

    await act(async () => {
      await capturedOnSubmit!(
        "teacher-1",
        "2026-07-19",
        {},
        "",
        "",
        false,
        "",
        "",
        undefined,
        undefined,
        42, // masterActionStepId ← the value under test
      );
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    const payload = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.masterActionStepId).toBe(42);
  });
});

/* ================================================================== */
/* handleSubmitResumed forwards newActionStep into update/create       */
/* ================================================================== */
describe("Drafts page — handleSubmitResumed forwards action-step data", () => {
  beforeEach(() => {
    capturedOnSubmit = null;
    mockFetchDrafts.mockResolvedValue([DRAFT_STUB]);
    mockFetchSlug.mockResolvedValue("Q1");
    mockFetchDash.mockResolvedValue(DASHBOARD_STUB);
    mockCreate.mockResolvedValue({ id: "obs-new" });
    mockUpdate.mockResolvedValue({ id: "obs-upd" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes newActionStep into updateObservation when a draftId is present", async () => {
    const { default: DraftsPage } = await import("@/pages/drafts");
    const qc = makeQC();

    render(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(DraftsPage),
      ),
    );

    /* Wait for the drafts list to load and the Resume button to appear */
    await waitFor(
      () => expect(screen.getByText("Resume")).toBeTruthy(),
      { timeout: 2000 },
    );

    /* Click Resume — triggers handleResume → fetchDashboard → sets resumeData */
    fireEvent.click(screen.getByText("Resume"));

    /* Wait for the resumed modal to open */
    await waitFor(
      () => expect(screen.getByTestId("modal-open")).toBeTruthy(),
      { timeout: 2000 },
    );

    expect(capturedOnSubmit).not.toBeNull();

    const actionStep = { text: "Improve questioning", dueDate: "2026-08-15" };

    /* Simulate the modal calling onSubmit with draftId supplied (branch: updateObservation) */
    await act(async () => {
      await capturedOnSubmit!(
        "teacher-1",       // teacherId
        "2026-07-01",      // date
        { "d-1": 2 },      // scores
        "<p>Strong</p>",   // strengths
        "<p>Grow</p>",     // growthAreas
        false,             // isWalkthrough
        "10:00",           // time
        "Math",            // course
        "draft-abc",       // draftId ← triggers updateObservation
        actionStep,        // newActionStep ← the value under test
        undefined,         // masterActionStepId
      );
    });

    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockCreate).not.toHaveBeenCalled();
    const payload = mockUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.newActionStep).toEqual(actionStep);
  });

  it("passes newActionStep into createObservation when no draftId is present", async () => {
    const { default: DraftsPage } = await import("@/pages/drafts");
    const qc = makeQC();

    render(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(DraftsPage),
      ),
    );

    /* Wait for the drafts list to load and the Resume button to appear */
    await waitFor(
      () => expect(screen.getByText("Resume")).toBeTruthy(),
      { timeout: 2000 },
    );

    /* Click Resume — triggers handleResume → fetchDashboard → sets resumeData */
    fireEvent.click(screen.getByText("Resume"));

    /* Wait for the resumed modal to open */
    await waitFor(
      () => expect(screen.getByTestId("modal-open")).toBeTruthy(),
      { timeout: 2000 },
    );

    expect(capturedOnSubmit).not.toBeNull();

    const actionStep = { text: "Narrate the positive", dueDate: "2026-09-01" };

    /* Simulate the modal calling onSubmit without draftId (branch: createObservation) */
    await act(async () => {
      await capturedOnSubmit!(
        "teacher-1",       // teacherId
        "2026-07-01",      // date
        { "d-1": 3 },      // scores
        "<p>Well done</p>",// strengths
        "<p>Keep up</p>",  // growthAreas
        false,             // isWalkthrough
        "11:00",           // time
        "Science",         // course
        undefined,         // draftId ← omitted, triggers createObservation
        actionStep,        // newActionStep ← the value under test
        undefined,         // masterActionStepId
      );
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockUpdate).not.toHaveBeenCalled();
    const payload = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.newActionStep).toEqual(actionStep);
  });
});
