// @vitest-environment jsdom
/**
 * NewObservationModal — extending an action step instead of duplicating it
 *
 * This file used to assert the opposite behaviour: that clicking "Repeat last
 * action step" copied the old due date into the new action step box and
 * immediately showed a stale-date error. That was the bug. Repeating created a
 * SECOND open step saying the same thing, and prefilling a date that had
 * already passed meant the error fired every single time.
 *
 * Now the button extends the existing step. What matters:
 *
 *   1. It opens the extend panel with an EMPTY date and no error.
 *   2. The new action step box disappears — an observation either extends the
 *      existing step or assigns a new one, never both.
 *   3. Cancelling brings the new action step box back.
 *   4. Anything already typed into the new action step box is cleared, so a
 *      half-written step cannot ride along with the extension.
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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

const OPEN_STEP_PAST = {
  id:             99,
  text:           "Improve wait time",
  dueDate:        PAST_DATE,
  status:         "open" as const,
  createdAt:      "2020-01-01T00:00:00Z",
  assignedByName: null,
  masteredAt:     null,
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
describe("NewObservationModal — extending an action step", () => {
  beforeEach(() => {
    mockCreateObservation.mockResolvedValue({ id: "draft-abc" });
    mockUpdateObservation.mockResolvedValue({ id: "draft-abc" });
    mockFetchMyDrafts.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("opens the extend panel with an empty date and no error", async () => {
    /* The old due date is in the past — which is the normal case, since that
       is why you are extending. It must not be prefilled, and it must not
       produce an error before the observer has done anything. */
    mockFetchLatestActionStep.mockResolvedValue(OPEN_STEP_PAST);

    const { NewObservationModal } = await import("@/components/NewObservationModal");
    render(React.createElement(NewObservationModal, makeProps()));

    const extendBtn = await screen.findByRole("button", { name: /extend this action step/i });
    expect(screen.queryByText(STALE_ERROR)).toBeNull();

    fireEvent.click(extendBtn);

    expect(screen.getByText(/same step, new deadline/i)).toBeDefined();
    expect(screen.queryByText(STALE_ERROR)).toBeNull();

    const dueDate = screen.getByLabelText(/new due date/i) as HTMLInputElement;
    expect(dueDate.value).toBe("");
  });

  it("hides 'Mark as Mastered' while extending", async () => {
    /* Extending means "not done yet". Offering "Mark as Mastered" beside it
       asks the observer to say two contradictory things about one step. */
    mockFetchLatestActionStep.mockResolvedValue(OPEN_STEP_PAST);

    const { NewObservationModal } = await import("@/components/NewObservationModal");
    render(React.createElement(NewObservationModal, makeProps()));

    const extendBtn = await screen.findByRole("button", { name: /extend this action step/i });
    expect(screen.getByRole("button", { name: /mark action step as mastered/i })).toBeDefined();

    fireEvent.click(extendBtn);
    expect(screen.queryByRole("button", { name: /mark action step as mastered/i })).toBeNull();

    /* Cancelling brings it back. */
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.getByRole("button", { name: /mark action step as mastered/i })).toBeDefined();
  });

  it("hides the new action step box while extending, and brings it back on cancel", async () => {
    mockFetchLatestActionStep.mockResolvedValue(OPEN_STEP_PAST);

    const { NewObservationModal } = await import("@/components/NewObservationModal");
    render(React.createElement(NewObservationModal, makeProps()));

    const extendBtn = await screen.findByRole("button", { name: /extend this action step/i });
    expect(screen.getByText(/assign new action step/i)).toBeDefined();

    fireEvent.click(extendBtn);
    expect(screen.queryByText(/assign new action step/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.getByText(/assign new action step/i)).toBeDefined();
  });

  it("clears anything already typed into the new action step box", async () => {
    /* Otherwise a half-written new step could be submitted alongside the
       extension, which the server rejects outright. */
    mockFetchLatestActionStep.mockResolvedValue(OPEN_STEP_PAST);

    const { NewObservationModal } = await import("@/components/NewObservationModal");
    render(React.createElement(NewObservationModal, makeProps()));

    const extendBtn = await screen.findByRole("button", { name: /extend this action step/i });
    const stepBox = screen.getByLabelText(/^action step$/i) as HTMLTextAreaElement;
    fireEvent.change(stepBox, { target: { value: "Something else entirely" } });
    expect(stepBox.value).toBe("Something else entirely");

    fireEvent.click(extendBtn);
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    const stepBoxAgain = screen.getByLabelText(/^action step$/i) as HTMLTextAreaElement;
    expect(stepBoxAgain.value).toBe("");
  });
});
