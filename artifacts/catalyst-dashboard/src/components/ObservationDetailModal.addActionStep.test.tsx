// @vitest-environment jsdom
/**
 * Writing the FIRST action step on an observation already filed.
 *
 * An action step could only be written while the observation was. An observer
 * who settled on the step during the debrief had to leave it off the record or
 * log the observation a second time — the Action Steps block appeared only when
 * a step was already there, so correcting one was possible and adding one was
 * not.
 *
 * The server has always accepted `newActionStep` on a save and created the step
 * when the observation has none. This is the way in.
 *
 * Its sibling file covers CORRECTING a step that exists; the two paths are
 * deliberately separate — an existing step goes through its own endpoint, a
 * new one rides with the observation's save.
 */

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/* ── API mocks ── */
const mockFetchActionSteps = vi.fn();
const mockUpdateActionStep = vi.fn();

class FakeHttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

vi.mock("@/lib/api", () => ({
  fetchActionSteps:  (...a: unknown[]) => mockFetchActionSteps(...a),
  fetchDeleteImpact: vi.fn().mockResolvedValue({ stepsToDelete: [] }),
  updateActionStep:  (...a: unknown[]) => mockUpdateActionStep(...a),
  HttpError:         FakeHttpError,
}));

/* ── Radix Dialog: render inline so jsdom can see the body ── */
vi.mock("@radix-ui/react-dialog", () => ({
  Root: ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
    open ? React.createElement(React.Fragment, null, children) : null,
  Portal:  ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  Overlay: () => null,
  Content: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
  Title:       ({ children }: { children: React.ReactNode }) => React.createElement("h2", null, children),
  Description: ({ children }: { children: React.ReactNode }) => React.createElement("p", null, children),
  Close:       ({ children }: { children: React.ReactNode }) => React.createElement("button", null, children),
}));

vi.mock("@/components/ui/alert-dialog", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  return {
    AlertDialog: ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
      open ? React.createElement(React.Fragment, null, children) : null,
    AlertDialogAction:      Passthrough,
    AlertDialogCancel:      Passthrough,
    AlertDialogContent:     Passthrough,
    AlertDialogDescription: Passthrough,
    AlertDialogFooter:      Passthrough,
    AlertDialogHeader:      Passthrough,
    AlertDialogTitle:       Passthrough,
  };
});

vi.mock("@/components/RichTextEditor", () => ({
  RichTextEditor: ({ value }: { value: string }) => React.createElement("div", null, value),
}));
vi.mock("@/components/RichTextDisplay", () => ({
  RichTextDisplay: ({ content }: { content?: string }) => React.createElement("div", null, content ?? ""),
}));
vi.mock("@/components/EmailFeedbackPanel", () => ({ EmailFeedbackPanel: () => null }));
vi.mock("@/components/ScoreCell", () => ({ getScoreColorExact: () => "#000000" }));

vi.mock("lucide-react", () => ({
  X: () => null, Pencil: () => null, Check: () => null,
  ChevronLeft: () => null, Trash2: () => null, Mail: () => null,
}));

/* ── Fixtures ── */
function isoDaysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0]!;
}

const onSave = vi.fn().mockResolvedValue(undefined);

async function renderModal(extraProps: Record<string, unknown> = {}) {
  const { ObservationDetailModal } = await import("@/components/ObservationDetailModal");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    React.createElement(
      QueryClientProvider,
      { client: qc },
      React.createElement(ObservationDetailModal, {
        teacher: { name: "Meg Alvarez", gradeLevel: ["5"], employeeId: "emp-teacher-1" },
        observation: {
          id: "obs-1",
          date: isoDaysFromToday(-20),
          observer: "Test Coach",
          scores: {},
          strengths: "Strong routines.",
          growthAreas: "Pacing.",
        },
        categories: [],
        canEdit: true,
        open: true,
        onOpenChange: () => {},
        onSave,
        ...extraProps,
      } as never),
    ),
  );
  /* The steps fetch resolves empty; wait for the modal itself to settle before
     pressing Edit, or the effect lands mid-edit and reseeds the boxes. */
  await screen.findByText("Edit Observation");
  fireEvent.click(screen.getByText("Edit Observation"));
}

describe("Adding the first action step to a filed observation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onSave.mockResolvedValue(undefined);
    mockFetchActionSteps.mockResolvedValue([]);
  });

  it("offers the boxes on an observation that has no step", async () => {
    await renderModal();
    expect(await screen.findByText("↻ Add an Action Step")).toBeTruthy();
    expect(screen.getByLabelText("Action Step")).toBeTruthy();
    expect(screen.getByLabelText("Due Date")).toBeTruthy();
  });

  it("does not offer them until Edit is pressed", async () => {
    const { ObservationDetailModal } = await import("@/components/ObservationDetailModal");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(ObservationDetailModal, {
          teacher: { name: "Meg Alvarez", gradeLevel: ["5"], employeeId: "emp-teacher-1" },
          observation: { id: "obs-1", date: isoDaysFromToday(-20), observer: "Test Coach", scores: {} },
          categories: [],
          canEdit: true,
          open: true,
          onOpenChange: () => {},
          onSave,
        } as never),
      ),
    );
    await screen.findByText("Edit Observation");
    expect(screen.queryByText("↻ Add an Action Step")).toBeNull();
  });

  it("sends the new step alongside the observation's own save", async () => {
    await renderModal();

    fireEvent.change(screen.getByLabelText("Action Step"), {
      target: { value: "Narrate the positive during independent work." },
    });
    fireEvent.change(screen.getByLabelText("Due Date"), {
      target: { value: isoDaysFromToday(14) },
    });
    fireEvent.click(screen.getByText("Save Changes"));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0]!.newActionStep).toEqual({
      text: "Narrate the positive during independent work.",
      dueDate: isoDaysFromToday(14),
    });
    /* Creating a step is the observation's own save, not the edit endpoint. */
    expect(mockUpdateActionStep).not.toHaveBeenCalled();
  });

  it("saves the observation with no step when both boxes are left empty", async () => {
    await renderModal();

    fireEvent.click(screen.getByText("Save Changes"));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0]!).not.toHaveProperty("newActionStep");
  });

  it("refuses a step with no due date, and saves nothing at all", async () => {
    await renderModal();

    fireEvent.change(screen.getByLabelText("Action Step"), {
      target: { value: "Narrate the positive." },
    });
    fireEvent.click(screen.getByText("Save Changes"));

    await screen.findByText("An action step needs a due date.");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("refuses a due date with no step", async () => {
    await renderModal();

    fireEvent.change(screen.getByLabelText("Due Date"), {
      target: { value: isoDaysFromToday(14) },
    });
    fireEvent.click(screen.getByText("Save Changes"));

    await screen.findByText("An action step cannot be blank.");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("refuses a due date in the past before asking the server", async () => {
    await renderModal();

    fireEvent.change(screen.getByLabelText("Action Step"), {
      target: { value: "Narrate the positive." },
    });
    fireEvent.change(screen.getByLabelText("Due Date"), {
      target: { value: isoDaysFromToday(-1) },
    });
    fireEvent.click(screen.getByText("Save Changes"));

    await screen.findByText("An action step due date must be today or later.");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("says what the server said when the save is refused", async () => {
    onSave.mockRejectedValue(new FakeHttpError(400, "This observation is from a school year that has closed"));
    await renderModal();

    fireEvent.change(screen.getByLabelText("Action Step"), {
      target: { value: "Narrate the positive." },
    });
    fireEvent.change(screen.getByLabelText("Due Date"), {
      target: { value: isoDaysFromToday(14) },
    });
    fireEvent.click(screen.getByText("Save Changes"));

    await screen.findByText(
      "Could not save: This observation is from a school year that has closed",
    );
  });

  it("offers nothing on a school-wide observation, which cannot carry a step", async () => {
    await renderModal({
      schoolWide: true,
      teacher: { name: "Excellence Charter", gradeLevel: ["K-4"] },
    });
    expect(screen.queryByText("↻ Add an Action Step")).toBeNull();
  });

  it("offers nothing when this observation already assigned a step", async () => {
    mockFetchActionSteps.mockResolvedValue([{
      id: 77,
      teacherEmployeeId: "emp-teacher-1",
      assignedDuringObservationId: "obs-1",
      text: "Already assigned.",
      dueDate: isoDaysFromToday(14),
      status: "open",
    }]);
    await renderModal();

    await screen.findByLabelText("Action Step");
    expect(screen.queryByText("↻ Add an Action Step")).toBeNull();
  });

  it("offers nothing when the only step from it was already mastered", async () => {
    /* One step per observation on the server: a second would be swallowed
       rather than created, so the box would promise something it cannot do. */
    mockFetchActionSteps.mockResolvedValue([{
      id: 78,
      teacherEmployeeId: "emp-teacher-1",
      assignedDuringObservationId: "obs-1",
      text: "Finished work.",
      dueDate: isoDaysFromToday(-5),
      status: "mastered",
    }]);
    await renderModal();

    await screen.findByText("Finished work.");
    expect(screen.queryByText("↻ Add an Action Step")).toBeNull();
  });
});
