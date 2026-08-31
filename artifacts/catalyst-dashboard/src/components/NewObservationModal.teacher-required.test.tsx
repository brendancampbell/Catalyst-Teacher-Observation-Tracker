// @vitest-environment jsdom
/**
 * NewObservationModal — the form does not pick a person for you.
 *
 * Backlog #48. Opening the form from the toolbar used to arrive with a teacher
 * already selected: the first name in the school alphabetically. Filling it in
 * and submitting filed the observation against that person. On 31 Aug a school
 * leader did this four times in one day, and all four landed on somebody she
 * had not observed. Nothing looked wrong, because nothing was incomplete.
 *
 * What is pinned here:
 *
 *   1. Opened with nobody in mind, no teacher is selected
 *   2. Submitting without one is refused, and says why, next to Submit
 *   3. Nothing autosaves without a teacher, and the form says so out loud
 *   4. Opened from a teacher's row, that teacher is still pre-filled
 *
 * And separately: switching the teacher keeps the observation being written.
 * Scores and feedback describe the lesson, not the person the form points at.
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("@radix-ui/react-dialog", () => ({
  Root: ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
    open ? React.createElement(React.Fragment, null, children) : null,
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

/* Aaron sorts first. He is the person the old form filed against. */
const TEACHERS = [
  {
    id: "teacher-aaron", employeeId: "emp-001", name: "Aaron Abbott",
    firstName: "Aaron", lastName: "Abbott", subject: "Math",
    gradeLevel: ["9"], observations: [], email: "aaron@school.edu",
  },
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
    rubricSetId: 7, freshStart: true, ...overrides,
  };
}

function teacherSelect(): HTMLSelectElement {
  return screen.getByRole("combobox", { name: "" }) as HTMLSelectElement;
}

beforeEach(() => {
  mockCreateObservation.mockResolvedValue({ id: "draft-abc" });
  mockUpdateObservation.mockResolvedValue({ id: "draft-abc" });
  mockFetchMyDrafts.mockResolvedValue([]);
  mockFetchLatestActionStep.mockResolvedValue(null);
});

afterEach(() => { vi.clearAllMocks(); });

describe("Opening with no teacher in mind", () => {
  it("selects nobody, and offers a placeholder instead", async () => {
    const { NewObservationModal } = await import("@/components/NewObservationModal");
    render(React.createElement(NewObservationModal, makeProps()));

    expect(teacherSelect().value).toBe("");
    expect(screen.getByText("Select a teacher…")).toBeTruthy();
    /* The specific failure: Aaron sorts first and used to be pre-selected. */
    expect(teacherSelect().value).not.toBe("teacher-aaron");
  });

  it("refuses to submit until somebody is chosen, and says so", async () => {
    const props = makeProps();
    const { NewObservationModal } = await import("@/components/NewObservationModal");
    render(React.createElement(NewObservationModal, props));

    await act(async () => { fireEvent.click(screen.getByText("Submit")); });

    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/choose a teacher/i)).toBeTruthy();
  });

  it("submits once a teacher is chosen, against that teacher", async () => {
    const props = makeProps();
    const { NewObservationModal } = await import("@/components/NewObservationModal");
    render(React.createElement(NewObservationModal, props));

    await act(async () => {
      fireEvent.change(teacherSelect(), { target: { value: "teacher-zoe" } });
    });
    await act(async () => { fireEvent.click(screen.getByText("Submit")); });

    expect(props.onSubmit).toHaveBeenCalled();
    expect((props.onSubmit as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe("teacher-zoe");
  });

  it("writes no draft while nobody is selected", async () => {
    vi.useFakeTimers();
    try {
      const { NewObservationModal } = await import("@/components/NewObservationModal");
      render(React.createElement(NewObservationModal, makeProps()));

      fireEvent.click(screen.getByTitle("Proficient"));
      await act(async () => { await vi.advanceTimersByTimeAsync(2100); });

      /* An autosaved draft has to belong to somebody. */
      expect(mockCreateObservation).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps what was typed when the teacher is chosen afterwards", async () => {
    const { NewObservationModal } = await import("@/components/NewObservationModal");
    render(React.createElement(NewObservationModal, makeProps()));

    fireEvent.click(screen.getByTitle("Proficient"));
    await act(async () => {
      fireEvent.change(teacherSelect(), { target: { value: "teacher-zoe" } });
    });

    expect((screen.getByTitle("Proficient") as HTMLElement).className).toMatch(/bg-green/);
  });

  it("warns, where it would report saving, that nothing is being saved", async () => {
    /* The absence of "Saved 09:14" is not something anyone reads. With no
       teacher there is nothing to autosave against, so it says so. */
    const { NewObservationModal } = await import("@/components/NewObservationModal");
    render(React.createElement(NewObservationModal, makeProps()));

    expect(screen.queryByText(/not saving/i)).toBeNull();

    await act(async () => { fireEvent.click(screen.getByTitle("Proficient")); });

    expect(screen.getByText(/not saving — no teacher selected/i)).toBeTruthy();
  });

  it("drops the warning once a teacher is chosen", async () => {
    const { NewObservationModal } = await import("@/components/NewObservationModal");
    render(React.createElement(NewObservationModal, makeProps()));

    await act(async () => { fireEvent.click(screen.getByTitle("Proficient")); });
    await act(async () => {
      fireEvent.change(teacherSelect(), { target: { value: "teacher-zoe" } });
    });

    expect(screen.queryByText(/not saving/i)).toBeNull();
  });
});

/* ================================================================== */
/* Switching teacher                                                  */
/* ================================================================== */
describe("Switching from one teacher to another", () => {
  /* Correcting the name should not cost you the observation. Everything that
     describes the lesson stays; only what belonged to the other person goes. */

  async function renderWithScoreAndFeedback() {
    const props = makeProps({ defaultTeacherId: "teacher-aaron" });
    const { NewObservationModal } = await import("@/components/NewObservationModal");
    render(React.createElement(NewObservationModal, props));

    await act(async () => { fireEvent.click(screen.getByTitle("Proficient")); });
    const editors = screen.getAllByTestId("rich-editor") as HTMLTextAreaElement[];
    await act(async () => {
      fireEvent.change(editors[0]!, { target: { value: "<p>Strong do-now</p>" } });
    });
    return props;
  }

  it("keeps the scores and the written feedback", async () => {
    await renderWithScoreAndFeedback();

    await act(async () => {
      fireEvent.change(teacherSelect(), { target: { value: "teacher-zoe" } });
    });

    expect((screen.getByTitle("Proficient") as HTMLElement).className).toMatch(/bg-green/);
    const editors = screen.getAllByTestId("rich-editor") as HTMLTextAreaElement[];
    expect(editors[0]!.value).toBe("<p>Strong do-now</p>");
  });

  it("files the kept work against the teacher now selected", async () => {
    const props = await renderWithScoreAndFeedback();

    await act(async () => {
      fireEvent.change(teacherSelect(), { target: { value: "teacher-zoe" } });
    });
    await act(async () => { fireEvent.click(screen.getByText("Submit")); });

    expect((props.onSubmit as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe("teacher-zoe");
  });

  it("looks up the newly chosen teacher's own action step", async () => {
    await renderWithScoreAndFeedback();
    mockFetchLatestActionStep.mockClear();

    await act(async () => {
      fireEvent.change(teacherSelect(), { target: { value: "teacher-zoe" } });
    });

    /* Zoe's open step, not Aaron's — this is about the person, so it reloads. */
    expect(mockFetchLatestActionStep).toHaveBeenCalledWith("emp-002");
  });

  it("starts a new draft rather than saving into the other teacher's", async () => {
    /* The update payload carries no teacher. Saving again into Aaron's draft
       would leave it filed against Aaron while the form says Zoe. */
    vi.useFakeTimers();
    try {
      const props = makeProps({ defaultTeacherId: "teacher-aaron" });
      const { NewObservationModal } = await import("@/components/NewObservationModal");
      render(React.createElement(NewObservationModal, props));

      fireEvent.click(screen.getByTitle("Proficient"));
      await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
      expect(mockCreateObservation).toHaveBeenCalledTimes(1);

      await act(async () => {
        fireEvent.change(teacherSelect(), { target: { value: "teacher-zoe" } });
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(2100); });

      /* A second create, for Zoe — not an update of Aaron's draft. */
      expect(mockUpdateObservation).not.toHaveBeenCalled();
      expect(mockCreateObservation).toHaveBeenCalledTimes(2);
      const second = mockCreateObservation.mock.calls[1]![0] as Record<string, unknown>;
      expect(second.observedEmployeeId ?? second.teacherId).toBe("teacher-zoe");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Opening from a teacher's row", () => {
  it("still pre-fills that teacher", async () => {
    const { NewObservationModal } = await import("@/components/NewObservationModal");
    render(React.createElement(NewObservationModal, makeProps({ defaultTeacherId: "teacher-zoe" })));

    expect(teacherSelect().value).toBe("teacher-zoe");
  });

  it("submits against that teacher without further choosing", async () => {
    const props = makeProps({ defaultTeacherId: "teacher-zoe" });
    const { NewObservationModal } = await import("@/components/NewObservationModal");
    render(React.createElement(NewObservationModal, props));

    await act(async () => { fireEvent.click(screen.getByText("Submit")); });

    expect((props.onSubmit as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe("teacher-zoe");
  });
});
