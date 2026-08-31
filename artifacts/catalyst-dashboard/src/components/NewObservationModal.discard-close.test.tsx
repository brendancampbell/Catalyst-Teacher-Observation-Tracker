// @vitest-environment jsdom
/**
 * NewObservationModal — discarding a draft, and closing the observation.
 *
 * Four behaviours, all about not losing somebody's written feedback silently:
 *
 *   1. Discard asks first, and declining changes nothing
 *   2. Confirming discards AND closes the modal — an empty form left open
 *      where the draft was reads as though nothing happened
 *   3. Closing with a save still in flight asks before losing it
 *   4. Closing after a successful save says so, and points at the Drafts page
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

/* ── Radix Dialog: inline, with a handle to trigger the dismiss path ──
   The real dialog closes on Escape, on an overlay click and via its X. All
   three land on Root's onOpenChange, which is the path under test. */
vi.mock("@radix-ui/react-dialog", () => ({
  Root: ({ children, open, onOpenChange }: {
    children: React.ReactNode; open?: boolean; onOpenChange?: (o: boolean) => void;
  }) =>
    open
      ? React.createElement(React.Fragment, null,
          React.createElement("button", {
            "data-testid": "dialog-dismiss",
            onClick: () => onOpenChange?.(false),
          }, "dismiss"),
          children)
      : null,
  Portal:  ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  Overlay: () => null,
  Content: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "modal-content" }, children),
  Title:   ({ children }: { children: React.ReactNode }) => React.createElement("h2", null, children),
  Close:   ({ children, className }: { children: React.ReactNode; className?: string }) =>
    React.createElement("button", { className }, children),
}));

vi.mock("@/components/RichTextEditor", () => ({
  RichTextEditor: ({ value, onChange, placeholder }: {
    value: string; onChange: (v: string) => void; placeholder?: string;
  }) =>
    React.createElement("textarea", {
      "data-testid": "rich-editor",
      placeholder,
      value,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value),
    }),
}));

vi.mock("lucide-react", () => ({
  X: () => null, Plus: () => null, Loader2: () => null,
  RotateCcw: () => null, AlertCircle: () => null, RefreshCw: () => null,
}));

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  toast:    (...args: unknown[]) => mockToast(...args),
  useToast: () => ({ toast: (...args: unknown[]) => mockToast(...args) }),
}));

vi.mock("@/lib/subject-audience", () => ({ teacherMatchesAudience: () => true }));

const mockCreateObservation     = vi.fn();
const mockUpdateObservation     = vi.fn();
const mockDeleteObservation     = vi.fn();
const mockFetchMyDrafts         = vi.fn();
const mockFetchLatestActionStep = vi.fn();

vi.mock("@/lib/api", () => ({
  createObservation:     (...a: unknown[]) => mockCreateObservation(...a),
  updateObservation:     (...a: unknown[]) => mockUpdateObservation(...a),
  deleteObservation:     (...a: unknown[]) => mockDeleteObservation(...a),
  fetchMyDrafts:         (...a: unknown[]) => mockFetchMyDrafts(...a),
  fetchLatestActionStep: (...a: unknown[]) => mockFetchLatestActionStep(...a),
}));

const TEACHERS = [{
  id: "teacher-1", employeeId: "emp-001", name: "Alice Smith",
  firstName: "Alice", lastName: "Smith", subject: "Math",
  gradeLevel: ["9"], observations: [], email: "alice@school.edu",
}];
const CATEGORIES  = [{ id: "cat-1", label: "Instruction", domains: [{ id: "domain-1", label: "Planning" }] }];
const ALL_DOMAINS = [{ id: "domain-1", label: "Planning" }];

const STUB_DRAFT = {
  id: "draft-abc", observedEmployeeId: "teacher-1", rubricSetId: 7,
  date: "2026-07-15", time: "09:30", course: "Algebra I",
  scores: { "domain-1": 1 }, strengths: "<p>Great lesson</p>",
  growthAreas: "<p>Pacing</p>", status: "draft" as const, isWalkthrough: false,
};

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    teachers: TEACHERS as never, categories: CATEGORIES, allDomains: ALL_DOMAINS,
    open: true, onOpenChange: vi.fn(), onSubmit: vi.fn().mockResolvedValue("obs-new"),
    /* The form no longer picks a teacher for you — opened with nobody chosen
       it writes no draft at all. These tests are about autosave and closing,
       so they open it the way a teacher's row does, with the person named. */
    defaultTeacherId: "teacher-1",
    rubricSetId: 7, freshStart: true, ...overrides,
  };
}

let confirmSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mockCreateObservation.mockResolvedValue({ id: "draft-abc" });
  mockUpdateObservation.mockResolvedValue({ id: "draft-abc" });
  mockDeleteObservation.mockResolvedValue(undefined);
  mockFetchMyDrafts.mockResolvedValue([]);
  mockFetchLatestActionStep.mockResolvedValue(null);
  confirmSpy = vi.spyOn(window, "confirm");
});

afterEach(() => {
  vi.clearAllMocks();
  confirmSpy.mockRestore();
});

/* ================================================================== */
/* Discarding a resumed draft                                         */
/* ================================================================== */
describe("Discarding a draft", () => {
  async function renderResumedDraft(extra: Record<string, unknown> = {}) {
    mockFetchMyDrafts.mockResolvedValue([STUB_DRAFT]);
    const props = makeProps({ resumeDraftId: "draft-abc", freshStart: false, ...extra });
    const { NewObservationModal } = await import("@/components/NewObservationModal");
    render(React.createElement(NewObservationModal, props));
    const discard = await screen.findByText("Discard");
    return { props, discard };
  }

  it("asks before discarding, and declining changes nothing", async () => {
    confirmSpy.mockReturnValue(false);
    const { props, discard } = await renderResumedDraft();

    await act(async () => { fireEvent.click(discard); });

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(mockDeleteObservation).not.toHaveBeenCalled();
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("warns that it cannot be undone", async () => {
    confirmSpy.mockReturnValue(false);
    const { discard } = await renderResumedDraft();

    await act(async () => { fireEvent.click(discard); });

    expect(String(confirmSpy.mock.calls[0]![0])).toMatch(/cannot be undone/i);
  });

  it("reports the discard, so a list showing that draft can drop the row", async () => {
    /* The Drafts page is often the page underneath. Without this it would keep
       showing a draft that no longer exists until the next refresh, which
       reads as the discard having failed. */
    confirmSpy.mockReturnValue(true);
    const onDraftDiscarded = vi.fn();
    const { discard } = await renderResumedDraft({ onDraftDiscarded });

    await act(async () => { fireEvent.click(discard); });

    await waitFor(() => expect(onDraftDiscarded).toHaveBeenCalledWith("draft-abc"));
  });

  it("discards and closes the modal once confirmed", async () => {
    confirmSpy.mockReturnValue(true);
    const { props, discard } = await renderResumedDraft();

    await act(async () => { fireEvent.click(discard); });

    await waitFor(() => expect(mockDeleteObservation).toHaveBeenCalledWith("draft-abc"));
    /* Leaving an empty form open where the draft was reads as a no-op. */
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
  });
});

/* ================================================================== */
/* Autosave depends on a rubric set                                   */
/* ================================================================== */
describe("Autosave needs a rubric set", () => {
  /* Two call sites shipped without passing rubricSetId — the Drafts page and
     the Action Center — and observations started there silently never wrote a
     draft. Nothing failed and nothing was logged; the work was simply gone.
     The dependency is invisible at the call site, so it is pinned here. */

  it("writes a draft when a rubric set is supplied", async () => {
    vi.useFakeTimers();
    try {
      const { NewObservationModal } = await import("@/components/NewObservationModal");
      render(React.createElement(NewObservationModal, makeProps({ rubricSetId: 7 })));

      fireEvent.click(screen.getByTitle("Proficient"));
      await act(async () => { await vi.advanceTimersByTimeAsync(2100); });

      expect(mockCreateObservation).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("writes nothing at all when the rubric set is missing", async () => {
    vi.useFakeTimers();
    try {
      const { NewObservationModal } = await import("@/components/NewObservationModal");
      render(React.createElement(NewObservationModal, makeProps({ rubricSetId: undefined })));

      fireEvent.click(screen.getByTitle("Proficient"));
      await act(async () => { await vi.advanceTimersByTimeAsync(2100); });

      /* This is the behaviour that bit us. Documented, not endorsed: a caller
         that forgets the prop gets silence. */
      expect(mockCreateObservation).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ================================================================== */
/* Closing the observation                                            */
/* ================================================================== */
describe("Closing an observation", () => {
  it("closes silently when nothing has been entered", async () => {
    const props = makeProps();
    const { NewObservationModal } = await import("@/components/NewObservationModal");
    render(React.createElement(NewObservationModal, props));

    await act(async () => { fireEvent.click(screen.getByTestId("dialog-dismiss")); });

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalled();
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("asks before closing while a save is still in flight", async () => {
    confirmSpy.mockReturnValue(false);
    const props = makeProps();
    const { NewObservationModal } = await import("@/components/NewObservationModal");
    render(React.createElement(NewObservationModal, props));

    /* Score it but do not let the 2-second autosave debounce elapse, so the
       write has not been acknowledged. */
    fireEvent.click(screen.getByTitle("Proficient"));

    await act(async () => { fireEvent.click(screen.getByTestId("dialog-dismiss")); });

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(String(confirmSpy.mock.calls[0]![0])).toMatch(/not finished saving/i);
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("closes anyway when the warning is accepted", async () => {
    confirmSpy.mockReturnValue(true);
    const props = makeProps();
    const { NewObservationModal } = await import("@/components/NewObservationModal");
    render(React.createElement(NewObservationModal, props));

    fireEvent.click(screen.getByTitle("Proficient"));
    await act(async () => { fireEvent.click(screen.getByTestId("dialog-dismiss")); });

    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("says the draft was saved, and points at the Drafts page", async () => {
    vi.useFakeTimers();
    try {
      const props = makeProps();
      const { NewObservationModal } = await import("@/components/NewObservationModal");
      render(React.createElement(NewObservationModal, props));

      fireEvent.click(screen.getByTitle("Proficient"));

      /* Let the autosave debounce fire and the write settle. */
      await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
      expect(mockCreateObservation).toHaveBeenCalled();

      await act(async () => { fireEvent.click(screen.getByTestId("dialog-dismiss")); });

      expect(confirmSpy).not.toHaveBeenCalled();
      const titles = mockToast.mock.calls.map((c) => (c[0] as { title?: string })?.title);
      expect(titles).toContain("Draft saved");
      expect(props.onOpenChange).toHaveBeenCalledWith(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
