// @vitest-environment jsdom
/**
 * Correcting an action step on an observation already filed.
 *
 * Scores, glows and grows have always been correctable after the fact; the
 * action step was displayed and nothing more, so a typo or a wrong due date
 * stood forever. The server has allowed the edit all along — there was simply
 * no way to ask for it.
 *
 * The overdue case is the one worth guarding. Correcting a step that has sailed
 * past its date is the commonest reason to touch one at all, and the server
 * refuses any dueDate in the past. Sending the step's own date back alongside
 * an unrelated wording fix would fail the edit on a field nobody touched.
 */

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
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
const TODAY = new Date().toISOString().split("T")[0]!;

function isoDaysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0]!;
}

function makeStep(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 77,
    teacherEmployeeId: "emp-teacher-1",
    assignedDuringObservationId: "obs-1",
    text: "Narrate the positive during independent work.",
    dueDate: isoDaysFromToday(14),
    status: "open",
    createdAt: new Date().toISOString(),
    ...over,
  };
}

const onSave = vi.fn().mockResolvedValue(undefined);

async function renderModal() {
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
      } as never),
    ),
  );
  /* The steps arrive from an effect; wait for the one this observation gave. */
  await screen.findByText("Narrate the positive during independent work.");
  fireEvent.click(screen.getByText("Edit Observation"));
}

describe("Editing the action step on a filed observation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onSave.mockResolvedValue(undefined);
    mockUpdateActionStep.mockResolvedValue({ ok: true });
  });

  it("sends the corrected wording, and nothing else", async () => {
    mockFetchActionSteps.mockResolvedValue([makeStep()]);
    await renderModal();

    fireEvent.change(screen.getByLabelText("Action Step"), {
      target: { value: "Narrate the positive during independent practice." },
    });
    fireEvent.click(screen.getByText("Save Changes"));

    await waitFor(() => expect(mockUpdateActionStep).toHaveBeenCalledTimes(1));
    expect(mockUpdateActionStep).toHaveBeenCalledWith(77, {
      text: "Narrate the positive during independent practice.",
    });
    /* The observation itself still saves in the same press. */
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it("does not resend an overdue step's own due date when only the wording changed", async () => {
    mockFetchActionSteps.mockResolvedValue([makeStep({ dueDate: isoDaysFromToday(-3) })]);
    await renderModal();

    fireEvent.change(screen.getByLabelText("Action Step"), {
      target: { value: "Corrected wording." },
    });
    fireEvent.click(screen.getByText("Save Changes"));

    await waitFor(() => expect(mockUpdateActionStep).toHaveBeenCalledTimes(1));
    const [, changes] = mockUpdateActionStep.mock.calls[0]!;
    expect(changes).toEqual({ text: "Corrected wording." });
    expect(changes).not.toHaveProperty("dueDate");
  });

  it("sends a new due date on its own when the wording is untouched", async () => {
    mockFetchActionSteps.mockResolvedValue([makeStep()]);
    await renderModal();

    fireEvent.change(screen.getByLabelText("Due Date"), {
      target: { value: isoDaysFromToday(30) },
    });
    fireEvent.click(screen.getByText("Save Changes"));

    await waitFor(() => expect(mockUpdateActionStep).toHaveBeenCalledTimes(1));
    expect(mockUpdateActionStep).toHaveBeenCalledWith(77, { dueDate: isoDaysFromToday(30) });
  });

  it("leaves the step alone when neither field was touched", async () => {
    mockFetchActionSteps.mockResolvedValue([makeStep()]);
    await renderModal();

    fireEvent.click(screen.getByText("Save Changes"));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(mockUpdateActionStep).not.toHaveBeenCalled();
  });

  it("refuses a blank action step, and saves nothing at all", async () => {
    mockFetchActionSteps.mockResolvedValue([makeStep()]);
    await renderModal();

    fireEvent.change(screen.getByLabelText("Action Step"), { target: { value: "   " } });
    fireEvent.click(screen.getByText("Save Changes"));

    await screen.findByText("An action step cannot be blank.");
    expect(mockUpdateActionStep).not.toHaveBeenCalled();
    /* The whole save is held back, so nothing is half-written. */
    expect(onSave).not.toHaveBeenCalled();
  });

  it("refuses a due date in the past before asking the server", async () => {
    mockFetchActionSteps.mockResolvedValue([makeStep()]);
    await renderModal();

    fireEvent.change(screen.getByLabelText("Due Date"), {
      target: { value: isoDaysFromToday(-1) },
    });
    fireEvent.click(screen.getByText("Save Changes"));

    await screen.findByText("An action step due date must be today or later.");
    expect(mockUpdateActionStep).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("holds the observation back when the step is refused, and says why", async () => {
    mockFetchActionSteps.mockResolvedValue([makeStep()]);
    mockUpdateActionStep.mockRejectedValue(
      new FakeHttpError(400, "Cannot edit a mastered action step"),
    );
    await renderModal();

    fireEvent.change(screen.getByLabelText("Action Step"), { target: { value: "Reworded." } });
    fireEvent.click(screen.getByText("Save Changes"));

    await screen.findByText("Could not save the action step: Cannot edit a mastered action step");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("offers no editor for a step already mastered", async () => {
    mockFetchActionSteps.mockResolvedValue([makeStep({ status: "mastered" })]);
    await renderModal();

    expect(screen.queryByLabelText("Action Step")).toBeNull();
    expect(
      screen.getByText(/Already mastered, so it can no longer be edited/),
    ).toBeTruthy();
  });

  it("fills the boxes when the step lands after Edit was already pressed", async () => {
    /* The footer's Edit button is there before the steps are; pressing it early
       used to leave an empty box that saving would then refuse as blank. */
    let resolveSteps: (v: unknown) => void = () => {};
    mockFetchActionSteps.mockReturnValue(new Promise((r) => { resolveSteps = r; }));

    const { ObservationDetailModal } = await import("@/components/ObservationDetailModal");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(ObservationDetailModal, {
          teacher: { name: "Meg Alvarez", gradeLevel: ["5"], employeeId: "emp-teacher-1" },
          observation: { id: "obs-1", date: TODAY, observer: "Test Coach", scores: {} },
          categories: [], canEdit: true, open: true,
          onOpenChange: () => {}, onSave,
        } as never),
      ),
    );

    fireEvent.click(screen.getByText("Edit Observation"));
    await act(async () => { resolveSteps([makeStep()]); });

    const box = await screen.findByLabelText("Action Step");
    expect((box as HTMLTextAreaElement).value)
      .toBe("Narrate the positive during independent work.");
  });

  it("shows the step read-only until Edit is pressed", async () => {
    mockFetchActionSteps.mockResolvedValue([makeStep()]);
    const { ObservationDetailModal } = await import("@/components/ObservationDetailModal");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(ObservationDetailModal, {
          teacher: { name: "Meg Alvarez", gradeLevel: ["5"], employeeId: "emp-teacher-1" },
          observation: {
            id: "obs-1", date: TODAY, observer: "Test Coach", scores: {},
          },
          categories: [], canEdit: true, open: true,
          onOpenChange: () => {}, onSave,
        } as never),
      ),
    );

    await screen.findByText("Narrate the positive during independent work.");
    expect(screen.queryByLabelText("Action Step")).toBeNull();
  });
});
