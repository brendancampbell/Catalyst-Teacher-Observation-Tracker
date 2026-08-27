// @vitest-environment jsdom
/**
 * Drafts pop-up — action-step forwarding, and the open/close dance.
 *
 * The forwarding half was inherited from the Drafts page this replaced: a
 * resumed draft must carry newActionStep and masterActionStepId through to the
 * server, or action-step work is silently dropped on submit.
 *
 * The second half is new. The list is a pop-up now, and resuming a draft closes
 * it and reopens it afterwards rather than stacking a second window. Getting
 * that wrong strands somebody with no list and no observation, or with two
 * windows and two Close buttons.
 */

import React, { useState } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/* ── UserContext ── */
vi.mock("@/context/UserContext", () => ({
  useUser: () => ({
    currentUser: {
      id:                 "coach-1",
      employeeId:         "emp-coach-1",
      name:               "Test Coach",
      email:              "coach@school.edu",
      role:               "COACH",
      schoolId:           42,
      schoolAbbreviation: null,
    },
  }),
}));

/* ── API mocks ── */
const mockCreate      = vi.fn();
const mockUpdate      = vi.fn();
const mockFetchDrafts = vi.fn();
const mockFetchDash   = vi.fn();

vi.mock("@/lib/api", () => ({
  createObservation: (...a: unknown[]) => mockCreate(...a),
  updateObservation: (...a: unknown[]) => mockUpdate(...a),
  deleteObservation: vi.fn().mockResolvedValue(undefined),
  fetchMyDrafts:     (...a: unknown[]) => mockFetchDrafts(...a),
  fetchDashboard:    (...a: unknown[]) => mockFetchDash(...a),
}));

/* ── Radix Dialog: render inline so jsdom can see the list ── */
vi.mock("@radix-ui/react-dialog", () => ({
  Root: ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
    open ? React.createElement(React.Fragment, null, children) : null,
  Portal:  ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  Overlay: () => null,
  Content: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "drafts-open" }, children),
  Title:       ({ children }: { children: React.ReactNode }) => React.createElement("h2", null, children),
  Description: ({ children }: { children: React.ReactNode }) => React.createElement("p", null, children),
  Close:       ({ children }: { children: React.ReactNode }) => React.createElement("button", null, children),
}));

/* ── NewObservationModal: capture onSubmit / onOpenChange ── */
let capturedOnSubmit:     ((...args: unknown[]) => Promise<string>) | null = null;
let capturedOnOpenChange: ((open: boolean) => void) | null = null;

vi.mock("@/components/NewObservationModal", () => ({
  NewObservationModal: ({
    onSubmit, onOpenChange, open,
  }: {
    onSubmit: (...a: unknown[]) => Promise<string>;
    onOpenChange: (open: boolean) => void;
    open: boolean;
  }) => {
    capturedOnSubmit     = onSubmit;
    capturedOnOpenChange = onOpenChange;
    return open ? React.createElement("div", { "data-testid": "observation-open" }) : null;
  },
}));

/* ── Lucide icons ── */
vi.mock("lucide-react", () => ({
  FileEdit: () => null, Trash2: () => null, RotateCcw: () => null,
  FileX: () => null, Loader2: () => null, X: () => null,
  CheckSquare: () => null, Square: () => null, ChevronDown: () => null,
}));

/* ── Toast ── */
vi.mock("@/hooks/use-toast", () => ({
  toast: () => {},
  useToast: () => ({ toast: () => {} }),
}));

/* ── Fixtures ── */
const DASHBOARD_STUB = {
  teachers:   [],
  categories: [{ id: "cat-1", label: "Instruction", domains: [{ id: "d-1", label: "Planning" }] }],
  rubricSet:  { id: 7, slug: "Q1", name: "Q1 2026" },
};

const DRAFT_STUB = {
  id:                 "draft-abc",
  observedEmployeeId: "teacher-1",
  teacherName:        "Ms. Smith",
  date:               "2026-07-01",
  scores:             {},
  strengths:          "",
  growthAreas:        "",
  isWalkthrough:      false,
  status:             "draft",
  rubricSetId:        7,
  rubricSetSlug:      "Q1",
  rubricSetName:      "Q1 2026",
  course:             null,
  time:               null,
  schoolYearId:       null,
};

/* The pop-up controls its own visibility through the caller, exactly as the
   header does, so the open/close behaviour is exercised rather than pinned. */
async function renderModal() {
  const { DraftsModal } = await import("@/components/DraftsModal");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

  function Host() {
    const [open, setOpen] = useState(true);
    return React.createElement(DraftsModal, { open, onOpenChange: setOpen });
  }

  render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(Host)));
  await waitFor(() => expect(screen.getByText("Resume")).toBeTruthy(), { timeout: 2000 });
}

async function clickResume() {
  fireEvent.click(screen.getByText("Resume"));
  await waitFor(() => expect(screen.getByTestId("observation-open")).toBeTruthy(), { timeout: 2000 });
}

beforeEach(() => {
  capturedOnSubmit     = null;
  capturedOnOpenChange = null;
  mockFetchDrafts.mockResolvedValue([DRAFT_STUB]);
  mockFetchDash.mockResolvedValue(DASHBOARD_STUB);
  mockCreate.mockResolvedValue({ id: "obs-new" });
  mockUpdate.mockResolvedValue({ id: "obs-upd" });
});

afterEach(() => { vi.clearAllMocks(); });

describe("Drafts pop-up — resuming a draft", () => {
  it("steps aside rather than stacking a second window", async () => {
    await renderModal();
    expect(screen.getByTestId("drafts-open")).toBeTruthy();

    await clickResume();

    expect(screen.queryByTestId("drafts-open")).toBeNull();
    expect(screen.getByTestId("observation-open")).toBeTruthy();
  });

  it("comes back when the observation closes", async () => {
    /* So a run of drafts can be worked through without reopening the menu
       between each one. */
    await renderModal();
    await clickResume();

    await act(async () => { capturedOnOpenChange!(false); });

    await waitFor(() => expect(screen.getByTestId("drafts-open")).toBeTruthy());
    expect(screen.queryByTestId("observation-open")).toBeNull();
  });
});

describe("Drafts pop-up — action-step data survives the submit", () => {
  it("passes newActionStep into updateObservation when a draftId is present", async () => {
    await renderModal();
    await clickResume();

    const actionStep = { text: "Improve questioning", dueDate: "2026-08-15" };

    await act(async () => {
      await capturedOnSubmit!(
        "teacher-1", "2026-07-01", { "d-1": 2 }, "<p>Strong</p>", "<p>Grow</p>",
        false, "10:00", "Math",
        "draft-abc",   // draftId → updateObservation
        actionStep,
        undefined,
      );
    });

    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockCreate).not.toHaveBeenCalled();
    expect((mockUpdate.mock.calls[0]![1] as Record<string, unknown>).newActionStep).toEqual(actionStep);
  });

  it("passes newActionStep into createObservation when no draftId is present", async () => {
    await renderModal();
    await clickResume();

    const actionStep = { text: "Tighten the do-now", dueDate: "2026-08-20" };

    await act(async () => {
      await capturedOnSubmit!(
        "teacher-1", "2026-07-01", { "d-1": 2 }, "<p>Strong</p>", "<p>Grow</p>",
        false, "10:00", "Math",
        undefined,     // no draftId → createObservation
        actionStep,
        undefined,
      );
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect((mockCreate.mock.calls[0]![0] as Record<string, unknown>).newActionStep).toEqual(actionStep);
  });

  it("passes masterActionStepId through", async () => {
    await renderModal();
    await clickResume();

    await act(async () => {
      await capturedOnSubmit!(
        "teacher-1", "2026-07-01", { "d-1": 2 }, "<p>Strong</p>", "<p>Grow</p>",
        false, "10:00", "Math", "draft-abc", undefined,
        99,            // masterActionStepId
      );
    });

    expect((mockUpdate.mock.calls[0]![1] as Record<string, unknown>).masterActionStepId).toBe(99);
  });
});
