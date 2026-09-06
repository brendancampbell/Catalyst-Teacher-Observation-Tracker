// @vitest-environment jsdom
/**
 * Drafts pop-up — publishing a draft refreshes everything that shows it.
 *
 * This guards a real incident, 3 Sep 2026. An observation was drafted at 09:53,
 * published from My Drafts at 10:21, and reported missing from the teacher's
 * profile at 10:29 — while the drafts list correctly showed nothing pending.
 * The row was in the database the whole time, published and correctly stamped.
 *
 * The cause was this handler refreshing only QUERY_KEYS.myDrafts. The teacher
 * profile and the tracker grid read the dashboard cache, and the Action Center
 * reads latestActionSteps; neither was told anything had changed, so both kept
 * serving their pre-publish copy until something else happened to refetch. The
 * "Observation submitted!" toast fired regardless, which is why it read as a
 * save that had silently failed rather than a screen that had not caught up.
 *
 * So the assertion is about the keys, not the request: the write already
 * worked. Publishing from the dashboard's own New Observation button
 * invalidates these same three keys (Dashboard.tsx, handleNewObservation), and
 * the two paths must not drift apart again.
 */

import React, { useState } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/lib/queryKeys";

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

/* ── NewObservationModal: capture onSubmit ── */
let capturedOnSubmit: ((...args: unknown[]) => Promise<string>) | null = null;

vi.mock("@/components/NewObservationModal", () => ({
  NewObservationModal: ({
    onSubmit, open,
  }: {
    onSubmit: (...a: unknown[]) => Promise<string>;
    open: boolean;
  }) => {
    capturedOnSubmit = onSubmit;
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

/* Returns the client so the test can watch what the handler invalidates. */
async function renderModal() {
  const { DraftsModal } = await import("@/components/DraftsModal");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

  function Host() {
    const [open, setOpen] = useState(true);
    return React.createElement(DraftsModal, { open, onOpenChange: setOpen });
  }

  render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(Host)));
  await waitFor(() => expect(screen.getByText("Resume")).toBeTruthy(), { timeout: 2000 });
  return qc;
}

async function clickResume() {
  fireEvent.click(screen.getByText("Resume"));
  await waitFor(() => expect(screen.getByTestId("observation-open")).toBeTruthy(), { timeout: 2000 });
}

/* The keys a spy saw, as comparable strings. */
function invalidatedKeys(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((call: unknown[]) =>
    JSON.stringify((call[0] as { queryKey?: unknown } | undefined)?.queryKey),
  );
}

beforeEach(() => {
  capturedOnSubmit = null;
  mockFetchDrafts.mockResolvedValue([DRAFT_STUB]);
  mockFetchDash.mockResolvedValue(DASHBOARD_STUB);
  mockCreate.mockResolvedValue({ id: "obs-new" });
  mockUpdate.mockResolvedValue({ id: "obs-upd" });
});

afterEach(() => { vi.clearAllMocks(); });

describe("Drafts pop-up — publishing refreshes the screens that show the observation", () => {
  it("invalidates the dashboard, so the teacher profile stops serving its pre-publish copy", async () => {
    const qc  = await renderModal();
    const spy = vi.spyOn(qc, "invalidateQueries");
    await clickResume();

    await act(async () => {
      await capturedOnSubmit!(
        "teacher-1", "2026-09-03", { "d-1": 1 }, "<p>Strong</p>", "<p>Grow</p>",
        false, "09:53", "Math",
        "draft-abc",
      );
    });

    expect(invalidatedKeys(spy)).toContain(JSON.stringify(QUERY_KEYS.dashboard));
  });

  it("invalidates latestActionSteps, so a step assigned on publish reaches the Action Center", async () => {
    const qc  = await renderModal();
    const spy = vi.spyOn(qc, "invalidateQueries");
    await clickResume();

    await act(async () => {
      await capturedOnSubmit!(
        "teacher-1", "2026-09-03", { "d-1": 1 }, "<p>Strong</p>", "<p>Grow</p>",
        false, "09:53", "Math",
        "draft-abc",
        { text: "Narrate the positive", dueDate: "2026-09-11" },
      );
    });

    expect(invalidatedKeys(spy)).toContain(JSON.stringify(QUERY_KEYS.latestActionSteps));
  });

  it("invalidates that teacher's own action steps, not somebody else's", async () => {
    const qc  = await renderModal();
    const spy = vi.spyOn(qc, "invalidateQueries");
    await clickResume();

    await act(async () => {
      await capturedOnSubmit!(
        "teacher-1", "2026-09-03", { "d-1": 1 }, "<p>Strong</p>", "<p>Grow</p>",
        false, "09:53", "Math",
        "draft-abc",
      );
    });

    const keys = invalidatedKeys(spy);
    expect(keys).toContain(JSON.stringify([...QUERY_KEYS.actionSteps, "teacher-1"]));
    expect(keys).not.toContain(JSON.stringify([...QUERY_KEYS.actionSteps, "teacher-2"]));
  });

  it("still refreshes the drafts list, so the published row leaves it", async () => {
    /* The behaviour that was already right. Pinned so a future edit to the
       block above cannot drop it while adding the others. */
    const qc  = await renderModal();
    const spy = vi.spyOn(qc, "invalidateQueries");
    await clickResume();

    await act(async () => {
      await capturedOnSubmit!(
        "teacher-1", "2026-09-03", { "d-1": 1 }, "<p>Strong</p>", "<p>Grow</p>",
        false, "09:53", "Math",
        "draft-abc",
      );
    });

    expect(invalidatedKeys(spy)).toContain(JSON.stringify(QUERY_KEYS.myDrafts));
  });

  it("does not invalidate when the submit fails, because nothing changed", async () => {
    /* A failed publish leaves the draft where it is. Invalidating anyway would
       refetch every screen for no reason and, worse, make a failure look like
       a successful save that had simply not appeared yet.

       The failure is also handed back to the form rather than logged and
       dropped — backlog #58. The form is what keeps the observation on screen
       and says it was not saved, and it can only do that if it is told. */
    const qc = await renderModal();
    mockUpdate.mockRejectedValueOnce(new Error("network"));
    const spy = vi.spyOn(qc, "invalidateQueries");
    await clickResume();

    await act(async () => {
      await expect(capturedOnSubmit!(
        "teacher-1", "2026-09-03", { "d-1": 1 }, "<p>Strong</p>", "<p>Grow</p>",
        false, "09:53", "Math",
        "draft-abc",
      )).rejects.toThrow("network");
    });

    expect(invalidatedKeys(spy)).not.toContain(JSON.stringify(QUERY_KEYS.dashboard));
  });
});
