// @vitest-environment jsdom
/**
 * NewObservationModal — "Repeat last action step" due-date validation
 *
 * Covers the patched onClick handler (lines 1326–1333 of NewObservationModal.tsx):
 *
 *   1. Clicking "Repeat last action step" when the carried-over due date is in
 *      the past immediately shows a due-date error — before any submit attempt.
 *   2. Clicking "Repeat last action step" with a future due date shows no error
 *      (explicitly sets error to null, clearing any prior stale-date error).
 *   3. A prior stale-date error is cleared when the observer repeats the step
 *      after the due date has been updated to a future date (re-open cycle).
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

/* ── Radix Dialog: render inline so jsdom can find modal content ── */
vi.mock("@radix-ui/react-dialog", () => ({
  Root: ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
    open ? React.createElement(React.Fragment, null, children) : null,
  Portal: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  Overlay: () => null,
  Content: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "modal-content" }, children),
  Title: ({ children }: { children: React.ReactNode }) =>
    React.createElement("h2", null, children),
  Close: ({ children, className }: { children: React.ReactNode; className?: string }) =>
    React.createElement("button", { className }, children),
}));

/* ── RichTextEditor: simple textarea so the modal can render ── */
vi.mock("@/components/RichTextEditor", () => ({
  RichTextEditor: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
  }) =>
    React.createElement("textarea", {
      "data-testid": "rich-editor",
      placeholder,
      value,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value),
    }),
}));

/* ── Lucide icons: lightweight stubs ── */
vi.mock("lucide-react", () => ({
  X:           () => null,
  Plus:        () => null,
  Loader2:     () => null,
  RotateCcw:   () => null,
  AlertCircle: () => null,
  RefreshCw:   () => null,
}));

/* ── Toast hook: no-op ── */
vi.mock("@/hooks/use-toast", () => ({
  toast:    () => {},
  useToast: () => ({ toast: () => {} }),
}));

/* ── subject-audience: always passes ── */
vi.mock("@/lib/subject-audience", () => ({
  teacherMatchesAudience: () => true,
}));

/* ── API mocks ── */
const mockCreateObservation     = vi.fn();
const mockUpdateObservation     = vi.fn();
const mockFetchMyDrafts         = vi.fn();
const mockFetchLatestActionStep = vi.fn();

vi.mock("@/lib/api", () => ({
  createObservation:     (...args: unknown[]) => mockCreateObservation(...args),
  updateObservation:     (...args: unknown[]) => mockUpdateObservation(...args),
  fetchMyDrafts:         (...args: unknown[]) => mockFetchMyDrafts(...args),
  fetchLatestActionStep: (...args: unknown[]) => mockFetchLatestActionStep(...args),
  sendObservationEmail:  vi.fn(),
}));

/* ── Fixtures ── */
const TEACHERS = [
  {
    id:           "teacher-1",
    employeeId:   "emp-001",
    name:         "Alice Smith",
    firstName:    "Alice",
    lastName:     "Smith",
    subject:      "Math",
    gradeLevel:   ["9"],
    observations: [],
    email:        "alice@school.edu",
  },
];

const CATEGORIES = [
  {
    id:      "cat-1",
    label:   "Instruction",
    domains: [{ id: "domain-1", label: "Planning" }],
  },
];

const ALL_DOMAINS = [{ id: "domain-1", label: "Planning" }];

/* Dates that are unambiguously past / future relative to any test run */
const PAST_DATE   = "2020-01-01";
const FUTURE_DATE = "2099-12-31";

const OPEN_STEP_PAST = {
  id:             99,
  text:           "Improve wait time",
  dueDate:        PAST_DATE,
  status:         "open" as const,
  createdAt:      "2020-01-01T00:00:00Z",
  assignedByName: null,
  masteredAt:     null,
};

const OPEN_STEP_FUTURE = {
  ...OPEN_STEP_PAST,
  dueDate: FUTURE_DATE,
};

const STALE_ERROR = "Due date must be today or in the future. Please update it.";

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    teachers:         TEACHERS as never,
    categories:       CATEGORIES,
    allDomains:       ALL_DOMAINS,
    open:             true,
    onOpenChange:     vi.fn(),
    onSubmit:         vi.fn().mockResolvedValue("obs-new"),
    rubricSetId:      7,
    freshStart:       true,
    defaultTeacherId: "teacher-1",
    ...overrides,
  };
}

/* ================================================================== */
describe("NewObservationModal — 'Repeat last action step' due-date validation", () => {
  beforeEach(() => {
    mockCreateObservation.mockResolvedValue({ id: "draft-abc" });
    mockUpdateObservation.mockResolvedValue({ id: "draft-abc" });
    mockFetchMyDrafts.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /* ── Test 1 ─────────────────────────────────────────────────────── */
  it("shows due-date error immediately when repeating a step with a past due date", async () => {
    mockFetchLatestActionStep.mockResolvedValue(OPEN_STEP_PAST);

    const { NewObservationModal } = await import("@/components/NewObservationModal");
    render(React.createElement(NewObservationModal, makeProps()));

    /* Wait for fetchLatestActionStep to resolve so the Repeat button appears */
    const repeatBtn = await screen.findByRole("button", { name: /repeat last action step/i });

    /* No error before clicking */
    expect(screen.queryByText(STALE_ERROR)).toBeNull();

    /* Click — error must appear immediately, with no submit triggered */
    fireEvent.click(repeatBtn);

    expect(screen.getByText(STALE_ERROR)).toBeDefined();
  });

  /* ── Test 2 ─────────────────────────────────────────────────────── */
  it("shows no error (clears any prior error) when repeating a step with a future due date", async () => {
    /* First render with a past step so the error state is exercised,
       then re-open the modal with a future step to confirm the error
       is set to null (cleared) when the onClick null-branch fires.    */

    mockFetchLatestActionStep.mockResolvedValue(OPEN_STEP_PAST);

    const { NewObservationModal } = await import("@/components/NewObservationModal");
    const { rerender } = render(React.createElement(NewObservationModal, makeProps()));

    /* Establish a prior stale-date error */
    const repeatBtnPast = await screen.findByRole("button", { name: /repeat last action step/i });
    fireEvent.click(repeatBtnPast);
    expect(screen.getByText(STALE_ERROR)).toBeDefined();

    /* Close the modal (resets all state) then reopen with the future step */
    mockFetchLatestActionStep.mockResolvedValue(OPEN_STEP_FUTURE);

    await act(async () => {
      rerender(React.createElement(NewObservationModal, makeProps({ open: false })));
    });

    await act(async () => {
      rerender(React.createElement(NewObservationModal, makeProps({ open: true })));
    });

    /* Wait for the updated latestActionStep (future date) to load */
    const repeatBtnFuture = await screen.findByRole("button", { name: /repeat last action step/i });

    /* Click Repeat with the future-dated step — error must NOT appear */
    fireEvent.click(repeatBtnFuture);

    await waitFor(() => {
      expect(screen.queryByText(STALE_ERROR)).toBeNull();
    });
  });
});
