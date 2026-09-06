// @vitest-environment jsdom
/**
 * NewObservationModal — a save that fails must not look like a save that worked.
 *
 * Backlog #58, found 4 Sep while tracing why a published observation was not
 * appearing on a teacher's profile. It was not the cause of that, but it sits
 * in the same code path.
 *
 * The failure: when the save failed, the error went to the browser console,
 * the form was wiped and the window closed — exactly as on success. The
 * observer walked away believing the observation was filed. It was not, and
 * because the form had been cleared and no draft was left behind, the written
 * feedback was simply gone. Nothing anywhere recorded that it had happened,
 * which is why no query can say how often it did.
 *
 * What is pinned here:
 *
 *   1. A failed submit leaves the window open
 *   2. It says so, on screen, in words
 *   3. Everything typed is still in the form, ready to send again
 *   4. Submitting again after a failure works, and then closes normally
 *   5. Closing after a failure asks first
 *   6. Autosave starts protecting the form again once a submit has failed
 *   7. A successful submit still closes, silently, as before
 *
 * The phone already behaves this way — see catalyst-mobile's observation page,
 * which shows the error, keeps the form and holds a local copy. This is the
 * dashboard catching up, not a new idea.
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

/* Escape, the overlay and the X all land on Root's onOpenChange — the path
   that asks before throwing away an unsaved observation. */
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

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(), useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/subject-audience", () => ({ teacherMatchesAudience: () => true }));

const mockDeleteObservation     = vi.fn();
const mockFetchMyDrafts         = vi.fn();
const mockFetchLatestActionStep = vi.fn();
const mockSaveObservation       = vi.fn();

vi.mock("@/lib/api", () => ({
  deleteObservation:     (...a: unknown[]) => mockDeleteObservation(...a),
  fetchMyDrafts:         (...a: unknown[]) => mockFetchMyDrafts(...a),
  fetchLatestActionStep: (...a: unknown[]) => mockFetchLatestActionStep(...a),
}));

vi.mock("@/lib/observation-save", () => ({
  saveObservation: (...a: unknown[]) => mockSaveObservation(...a),
}));

const TEACHERS = [
  {
    id: "teacher-zoe", employeeId: "emp-002", name: "Zoe Zimmer",
    firstName: "Zoe", lastName: "Zimmer", subject: "ELA",
    gradeLevel: ["10"], observations: [], email: "zoe@school.edu",
  },
];
const CATEGORIES  = [{ id: "cat-1", label: "Instruction", domains: [{ id: "domain-1", label: "Planning" }] }];
const ALL_DOMAINS = [{ id: "domain-1", label: "Planning" }];

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    teachers: TEACHERS as never, categories: CATEGORIES, allDomains: ALL_DOMAINS,
    open: true, onOpenChange: vi.fn(), onSubmit: vi.fn().mockResolvedValue("obs-new"),
    defaultTeacherId: "teacher-zoe",
    rubricSetId: 7, freshStart: true, ...overrides,
  };
}

/* The observation as the observer left it: a score and written feedback. */
async function fillIn() {
  await act(async () => { fireEvent.click(screen.getByTitle("Proficient")); });
  const editors = screen.getAllByTestId("rich-editor") as HTMLTextAreaElement[];
  await act(async () => {
    fireEvent.change(editors[0]!, { target: { value: "<p>Strong do-now, tight transitions</p>" } });
  });
}

async function submit() {
  await act(async () => { fireEvent.click(screen.getByText("Submit")); });
}

beforeEach(() => {
  mockFetchMyDrafts.mockResolvedValue([]);
  mockFetchLatestActionStep.mockResolvedValue(null);
  mockSaveObservation.mockResolvedValue({ id: "draft-abc" });
});

afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

describe("When the save fails", () => {
  it("leaves the window open", async () => {
    const props = makeProps({
      onSubmit: vi.fn().mockRejectedValue(new Error("Network request failed")),
    });
    const { NewObservationModal } = await import("@/components/NewObservationModal");
    render(React.createElement(NewObservationModal, props));

    await fillIn();
    await submit();

    /* The whole bug in one assertion: this used to be called with false. */
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByTestId("modal-content")).toBeTruthy();
  });

  it("says what went wrong, in the server's own words", async () => {
    const props = makeProps({
      onSubmit: vi.fn().mockRejectedValue(new Error("Network request failed")),
    });
    const { NewObservationModal } = await import("@/components/NewObservationModal");
    render(React.createElement(NewObservationModal, props));

    await fillIn();
    await submit();

    expect(screen.getByRole("alert").textContent).toContain("Network request failed");
    expect(screen.getByText(/nothing has been filed/i)).toBeTruthy();
  });

  it("says something useful even when the failure carries no message", async () => {
    const props = makeProps({ onSubmit: vi.fn().mockRejectedValue(new Error("")) });
    const { NewObservationModal } = await import("@/components/NewObservationModal");
    render(React.createElement(NewObservationModal, props));

    await fillIn();
    await submit();

    expect(screen.getByRole("alert").textContent).toMatch(/could not be saved/i);
  });

  it("keeps the score and the written feedback", async () => {
    /* The part that cannot be recovered. A cleared form after a failed save is
       feedback the observer has to write again from memory, if they even
       realise they have to. */
    const props = makeProps({ onSubmit: vi.fn().mockRejectedValue(new Error("Server error")) });
    const { NewObservationModal } = await import("@/components/NewObservationModal");
    render(React.createElement(NewObservationModal, props));

    await fillIn();
    await submit();

    expect((screen.getByTitle("Proficient") as HTMLElement).className).toMatch(/bg-green/);
    const editors = screen.getAllByTestId("rich-editor") as HTMLTextAreaElement[];
    expect(editors[0]!.value).toBe("<p>Strong do-now, tight transitions</p>");
  });

  it("sends the same observation again when submitted a second time", async () => {
    const onSubmit = vi.fn()
      .mockRejectedValueOnce(new Error("Network request failed"))
      .mockResolvedValueOnce("obs-new");
    const props = makeProps({ onSubmit });
    const { NewObservationModal } = await import("@/components/NewObservationModal");
    render(React.createElement(NewObservationModal, props));

    await fillIn();
    await submit();
    await submit();

    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1]![0]).toBe("teacher-zoe");
    expect(onSubmit.mock.calls[1]![3]).toBe("<p>Strong do-now, tight transitions</p>");
    /* And now it closes, as a successful submit always has. */
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("asks before closing, and stays open if the answer is no", async () => {
    const props = makeProps({ onSubmit: vi.fn().mockRejectedValue(new Error("Server error")) });
    const { NewObservationModal } = await import("@/components/NewObservationModal");
    render(React.createElement(NewObservationModal, props));

    await fillIn();
    await submit();

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await act(async () => { fireEvent.click(screen.getByTestId("dialog-dismiss")); });

    expect(confirm).toHaveBeenCalled();
    expect(confirm.mock.calls[0]![0]).toMatch(/was not saved/i);
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("closes when the answer is yes", async () => {
    const props = makeProps({ onSubmit: vi.fn().mockRejectedValue(new Error("Server error")) });
    const { NewObservationModal } = await import("@/components/NewObservationModal");
    render(React.createElement(NewObservationModal, props));

    await fillIn();
    await submit();

    vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => { fireEvent.click(screen.getByTestId("dialog-dismiss")); });

    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("lets autosave protect the form again", async () => {
    /* Autosave stands down while a submit is in flight. It used not to matter,
       because the window was gone either way. Now the form is still on screen
       and is the only copy, so the next edit has to write a draft behind it. */
    vi.useFakeTimers();
    try {
      const props = makeProps({ onSubmit: vi.fn().mockRejectedValue(new Error("Server error")) });
      const { NewObservationModal } = await import("@/components/NewObservationModal");
      render(React.createElement(NewObservationModal, props));

      await act(async () => { fireEvent.click(screen.getByTitle("Proficient")); });
      await act(async () => { fireEvent.click(screen.getByText("Submit")); });
      mockSaveObservation.mockClear();

      await act(async () => { fireEvent.click(screen.getByTitle("Developing")); });
      await act(async () => { await vi.advanceTimersByTimeAsync(2100); });

      expect(mockSaveObservation).toHaveBeenCalled();
      expect((mockSaveObservation.mock.calls[0]![0] as { status: string }).status).toBe("draft");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("When the save works", () => {
  it("closes without saying anything", async () => {
    const props = makeProps();
    const { NewObservationModal } = await import("@/components/NewObservationModal");
    render(React.createElement(NewObservationModal, props));

    await fillIn();
    await submit();

    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
