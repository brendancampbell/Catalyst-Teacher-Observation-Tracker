/**
 * ObservationPage — draft restore integration tests
 *
 * Exercises the actual ObservationPage component so that the full
 * read-path is covered:
 *
 *   mount  →  auto-select teacher  →  checkForDraft()
 *          →  fetchMyDrafts() returns []
 *          →  localStorage fallback with localDraftKey(userId, rubricId, teacherId)
 *          →  form state hydrated
 *
 * Three scenarios:
 *   1. Draft auto-loads for first teacher on mount.
 *   2. Switching to Teacher B clears the form (Teacher B has no draft).
 *   3. Switching back to Teacher A re-runs checkForDraft and restores the draft.
 *   4. Raw localStorage entry for Teacher A is not mutated after a Teacher B visit.
 */

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ObservationPage, { localDraftKey } from "@/pages/observation";
import type { LocalDraft } from "@/pages/observation";
import { createObservation, updateObservation } from "@/lib/api";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: 42,
      role: "SCHOOL_LEADER",
      schoolId: 1,
      schoolName: "Test School",
    },
    isLoading: false,
  }),
}));

vi.mock("@/context/AppContext", () => ({
  useApp: () => ({
    selectedSchool: null,
    selectedRubric: {
      id: 7,
      slug: "default",
      name: "Test Rubric",
      subjectAudience: "ALL",
    },
    setSelectedSchool: vi.fn(),
  }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/observation", vi.fn()],
  useSearch: () => "",
}));

vi.mock("@/components/AppHeader", () => ({
  AppHeader: () => null,
}));

vi.mock("@/lib/roles", () => ({
  isNetworkScope: () => false,
}));

vi.mock("@/lib/subject-audience", () => ({
  teacherMatchesAudience: () => true,
}));

const mockFetchMyDrafts = vi.fn();
const mockApiFetch = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    fetchMyDrafts: (...args: unknown[]) => mockFetchMyDrafts(...args),
    apiFetch: (...args: unknown[]) => mockApiFetch(...args),
    createObservation: vi.fn(),
    updateObservation: vi.fn(),
  };
});

// ── Fixtures ───────────────────────────────────────────────────────────────

const TEACHER_A = {
  employeeId: "emp-001",
  id: "emp-001",
  firstName: "Alice",
  lastName: "Smith",
  department: "Math",
  isActive: true,
};

const TEACHER_B = {
  employeeId: "emp-002",
  id: "emp-002",
  firstName: "Bob",
  lastName: "Jones",
  department: "Science",
  isActive: true,
};

const RUBRIC_DATA = {
  rubricSet: { id: 7, slug: "default", name: "Test Rubric" },
  categories: [],
};

const USER_ID  = 42;
const RUBRIC_ID = 7;

function makeDraft(teacherId: string, strengths: string): LocalDraft {
  return {
    teacherId,
    date: "2026-07-13",
    course: "Algebra 1",
    scores: {},
    strengths,
    growthAreas: "Pacing",
    isWalkthrough: false,
    actionStepText: "",
    actionStepDueDate: "",
    masterActionStepId: null,
    savedAt: Date.now(),
  };
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ObservationPage />
    </QueryClientProvider>,
  );
}

function strengthsField(): HTMLTextAreaElement {
  return screen.getByPlaceholderText(
    "What is this teacher doing well?",
  ) as HTMLTextAreaElement;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("ObservationPage — draft restore round-trip", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();

    /* Server always returns no drafts → forces localStorage fallback path */
    mockFetchMyDrafts.mockResolvedValue([]);

    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes("/api/people")) {
        return Promise.resolve([TEACHER_A, TEACHER_B]);
      }
      if (url.includes("/api/rubric")) {
        return Promise.resolve(RUBRIC_DATA);
      }
      if (url.includes("/api/action-steps/latest")) {
        /* Return null so the action step banner does not render and
           avoids crashing on lastActionStep.dueDate when no prior step. */
        return Promise.resolve(null);
      }
      return Promise.resolve({});
    });
  });

  it("restores Teacher A's draft from localStorage on initial mount", async () => {
    const keyA = localDraftKey(USER_ID, RUBRIC_ID, "emp-001");
    localStorage.setItem(
      keyA,
      JSON.stringify(makeDraft("emp-001", "Excellent questioning technique")),
    );

    renderPage();

    await waitFor(
      () => expect(strengthsField().value).toBe("Excellent questioning technique"),
      { timeout: 4000 },
    );
  });

  it("switching to Teacher B clears Teacher A's draft fields", async () => {
    const keyA = localDraftKey(USER_ID, RUBRIC_ID, "emp-001");
    localStorage.setItem(
      keyA,
      JSON.stringify(makeDraft("emp-001", "Strong lesson structure")),
    );

    renderPage();

    /* Teacher A auto-selected on mount → draft loads */
    await waitFor(
      () => expect(strengthsField().value).toBe("Strong lesson structure"),
      { timeout: 4000 },
    );

    /* Switch to Teacher B — no draft for B → form resets */
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "emp-002" } });

    await waitFor(
      () => expect(strengthsField().value).toBe(""),
      { timeout: 4000 },
    );
  });

  it("switching back to Teacher A after Teacher B restores Teacher A's draft", async () => {
    const keyA = localDraftKey(USER_ID, RUBRIC_ID, "emp-001");
    localStorage.setItem(
      keyA,
      JSON.stringify(makeDraft("emp-001", "Great use of cold call")),
    );

    renderPage();

    /* Confirm Teacher A's draft loaded */
    const select = await screen.findByRole("combobox", {}, { timeout: 4000 });
    await waitFor(
      () => expect(strengthsField().value).toBe("Great use of cold call"),
      { timeout: 4000 },
    );

    /* Switch to Teacher B */
    fireEvent.change(select, { target: { value: "emp-002" } });
    await waitFor(
      () => expect(strengthsField().value).toBe(""),
      { timeout: 4000 },
    );

    /* Switch back to Teacher A — draft must restore */
    fireEvent.change(select, { target: { value: "emp-001" } });
    await waitFor(
      () => expect(strengthsField().value).toBe("Great use of cold call"),
      { timeout: 4000 },
    );
  });

  /* ── Action step field tests ────────────────────────────────────── */

  it("write + restore: action step fields are written to localStorage on input and restored on remount", async () => {
    /* ── Phase 1: user enters action step text → localStorage is written ── */
    const { unmount } = renderPage();

    /* Wait for Teacher A to be auto-selected (guarantees teacherId state is set) */
    const select = await screen.findByRole("combobox", {}, { timeout: 4000 }) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("emp-001"), { timeout: 4000 });

    /* Switch to Teacher B — no pre-seeded draft for B, so draftJustLoaded stays false
       and the NEXT form change will immediately write to localStorage.              */
    await act(async () => {
      fireEvent.change(select, { target: { value: "emp-002" } });
    });
    await waitFor(() => expect(select.value).toBe("emp-002"), { timeout: 4000 });

    const actionStepArea = () =>
      screen.getByPlaceholderText(
        "Describe the action step for this teacher…",
      ) as HTMLTextAreaElement;

    /* localStorage.setItem is called synchronously in the autosave useEffect */
    await act(async () => {
      fireEvent.change(actionStepArea(), { target: { value: "Use exit tickets" } });
    });

    const keyB = localDraftKey(USER_ID, RUBRIC_ID, "emp-002");
    await waitFor(() => {
      const raw = localStorage.getItem(keyB);
      expect(raw).not.toBeNull();
      const draft = JSON.parse(raw!) as LocalDraft;
      /* All three action-step fields must be present and correct */
      expect(draft.actionStepText).toBe("Use exit tickets");
      expect(Object.hasOwn(draft, "actionStepDueDate")).toBe(true);
      expect(Object.hasOwn(draft, "masterActionStepId")).toBe(true);
    }, { timeout: 4000 });

    unmount();

    /* ── Phase 2: remount → switch back to Teacher B → fields restore ── */
    renderPage();

    const select2 = await screen.findByRole("combobox", {}, { timeout: 4000 }) as HTMLSelectElement;
    await waitFor(() => expect(select2.value).not.toBe(""), { timeout: 4000 });
    await act(async () => {
      fireEvent.change(select2, { target: { value: "emp-002" } });
    });

    await waitFor(
      () => expect(actionStepArea().value).toBe("Use exit tickets"),
      { timeout: 4000 },
    );
  });

  it("restores action step text and due date from localStorage on mount", async () => {
    const keyA = localDraftKey(USER_ID, RUBRIC_ID, "emp-001");
    localStorage.setItem(
      keyA,
      JSON.stringify({
        ...makeDraft("emp-001", "Solid lesson structure"),
        actionStepText: "Use cold call technique",
        actionStepDueDate: "2026-09-01",
      }),
    );

    renderPage();

    const actionStepArea = () =>
      screen.getByPlaceholderText(
        "Describe the action step for this teacher…",
      ) as HTMLTextAreaElement;

    await waitFor(
      () => {
        expect(actionStepArea().value).toBe("Use cold call technique");
        /* Also assert the due date input is hydrated with the saved date */
        expect(screen.getByDisplayValue("2026-09-01")).toBeTruthy();
      },
      { timeout: 4000 },
    );
  });

  it("restores markMastered (checkbox checked) when masterActionStepId is saved in the draft", async () => {
    /* Override mock so the page has a last action step to check off */
    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes("/api/people")) return Promise.resolve([TEACHER_A, TEACHER_B]);
      if (url.includes("/api/rubric")) return Promise.resolve(RUBRIC_DATA);
      if (url.includes("/api/action-steps/latest")) {
        return Promise.resolve({
          id: 55,
          teacherEmployeeId: "emp-001",
          assignedByEmployeeId: "emp-admin",
          text: "Prior step from last observation",
          dueDate: "2026-08-15",
          status: "open",
          assignedAt: new Date().toISOString(),
        });
      }
      return Promise.resolve({});
    });

    const keyA = localDraftKey(USER_ID, RUBRIC_ID, "emp-001");
    localStorage.setItem(
      keyA,
      JSON.stringify({
        ...makeDraft("emp-001", "Great momentum"),
        masterActionStepId: 55,
      }),
    );

    renderPage();

    /* Checkbox only renders when lastActionStep is open; verify it ends up checked */
    await waitFor(
      () => expect(screen.getByRole("checkbox")).toBeChecked(),
      { timeout: 4000 },
    );
  });

  it("switching teachers clears action step text and due date fields", async () => {
    const keyA = localDraftKey(USER_ID, RUBRIC_ID, "emp-001");
    localStorage.setItem(
      keyA,
      JSON.stringify({
        ...makeDraft("emp-001", "Great routines"),
        actionStepText: "Improve wait time",
        actionStepDueDate: "2026-09-15",
      }),
    );

    renderPage();

    const actionStepArea = () =>
      screen.getByPlaceholderText(
        "Describe the action step for this teacher…",
      ) as HTMLTextAreaElement;

    /* Draft loads for Teacher A — verify both text and date */
    await waitFor(
      () => {
        expect(actionStepArea().value).toBe("Improve wait time");
        expect(screen.getByDisplayValue("2026-09-15")).toBeTruthy();
      },
      { timeout: 4000 },
    );

    /* Switch to Teacher B — no draft for B → action step fields clear */
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "emp-002" } });

    await waitFor(
      () => {
        expect(actionStepArea().value).toBe("");
        /* Due date value must also be cleared */
        expect(screen.queryByDisplayValue("2026-09-15")).toBeNull();
      },
      { timeout: 4000 },
    );
  });

  it("Teacher A's localStorage entry is not mutated after a Teacher B visit", async () => {
    const keyA = localDraftKey(USER_ID, RUBRIC_ID, "emp-001");
    const keyB = localDraftKey(USER_ID, RUBRIC_ID, "emp-002");
    localStorage.setItem(
      keyA,
      JSON.stringify(makeDraft("emp-001", "Excellent wait time")),
    );

    renderPage();

    await waitFor(
      () => expect(strengthsField().value).toBe("Excellent wait time"),
      { timeout: 4000 },
    );

    /* Switch to B and immediately back to A */
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "emp-002" } });
    fireEvent.change(select, { target: { value: "emp-001" } });

    await waitFor(
      () => expect(strengthsField().value).toBe("Excellent wait time"),
      { timeout: 4000 },
    );

    /* Raw localStorage must still hold Teacher A's original data */
    const rawA = localStorage.getItem(keyA);
    expect(rawA).not.toBeNull();
    const parsedA = JSON.parse(rawA!) as LocalDraft;
    expect(parsedA.teacherId).toBe("emp-001");
    expect(parsedA.strengths).toBe("Excellent wait time");

    /* Teacher B's key must not hold Teacher A's data if it was written */
    const rawB = localStorage.getItem(keyB);
    if (rawB) {
      const parsedB = JSON.parse(rawB) as LocalDraft;
      expect(parsedB.teacherId).toBe("emp-002");
    }
  });
});

// ── 0.0 score preservation ──────────────────────────────────────────────────

/**
 * These tests confirm that a 0.0 ("Not Yet") domain score is never silently
 * dropped by a falsy guard at any stage of the draft lifecycle:
 *
 *   1. localStorage restore → score hydrated into React state → score pill shown as selected
 *   2. Subsequent form change → score re-serialised to localStorage → 0 preserved
 *   3. Debounced autosave → createObservation called with scores["domain-a"] === 0
 *
 * RUBRIC_WITH_DOMAIN extends the standard fixture with one real domain so that
 * score pill buttons actually render and can be asserted against.
 */
describe("ObservationPage — 0.0 (Not Yet) score preservation through draft save-and-resume", () => {
  const RUBRIC_WITH_DOMAIN = {
    rubricSet: { id: 7, slug: "default", name: "Test Rubric" },
    categories: [
      {
        id: 1,
        name: "Instruction",
        domains: [{ id: 1, slug: "domain-a", name: "Clarity", description: "" }],
      },
    ],
  };

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();

    mockFetchMyDrafts.mockResolvedValue([]);

    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes("/api/people")) return Promise.resolve([TEACHER_A, TEACHER_B]);
      if (url.includes("/api/rubric")) return Promise.resolve(RUBRIC_WITH_DOMAIN);
      if (url.includes("/api/action-steps/latest")) return Promise.resolve(null);
      return Promise.resolve({});
    });

    vi.mocked(createObservation).mockResolvedValue({ id: "srv-draft-zero" } as never);
    vi.mocked(updateObservation).mockResolvedValue({ id: "srv-draft-zero" } as never);
  });

  it("restores a 0.0 score from localStorage: score pill shows as selected", async () => {
    const keyA = localDraftKey(USER_ID, RUBRIC_ID, "emp-001");
    localStorage.setItem(
      keyA,
      JSON.stringify({
        ...makeDraft("emp-001", "Good questioning"),
        scores: { "domain-a": 0 },
      }),
    );

    renderPage();

    await waitFor(
      () => {
        /* The "Not Yet" pill (value 0) must have the selected style (red background),
           not the unselected grey — confirming 0 was NOT treated as falsy. */
        const notYetBtn = screen.getByTitle("Not Yet");
        const style = window.getComputedStyle(notYetBtn);
        /* jsdom resolves inline styles; check backgroundColor or the style attribute */
        /* jsdom normalises hex colours to rgb() in inline styles */
        expect(notYetBtn.getAttribute("style")).toContain("rgb(252, 165, 165)");
      },
      { timeout: 4000 },
    );

    /* Also assert the raw localStorage entry still carries 0 (not undefined/dropped) */
    const raw = localStorage.getItem(keyA);
    expect(raw).not.toBeNull();
    const draft = JSON.parse(raw!) as LocalDraft;
    expect(Object.hasOwn(draft.scores, "domain-a")).toBe(true);
    expect(draft.scores["domain-a"]).toBe(0);
  });

  it("re-serialises 0.0 score to localStorage after a subsequent form change", async () => {
    const keyA = localDraftKey(USER_ID, RUBRIC_ID, "emp-001");
    localStorage.setItem(
      keyA,
      JSON.stringify({
        ...makeDraft("emp-001", ""),
        scores: { "domain-a": 0 },
      }),
    );

    renderPage();

    /* Wait for draft to load (score pill selected) */
    await waitFor(
      () => expect(screen.getByTitle("Not Yet").getAttribute("style")).toContain("rgb(252, 165, 165)"),
      { timeout: 4000 },
    );

    /* Trigger the autosave effect by typing into the Strengths field.
       This clears the draftJustLoaded guard and causes localStorage to be
       re-written synchronously within the same useEffect execution. */
    const ta = screen.getByPlaceholderText(
      "What is this teacher doing well?",
    ) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(ta, { target: { value: "Strong routines" } });
    });

    /* localStorage is written synchronously before the 2-second debounce timer;
       assert immediately that the 0 score was not lost. */
    await waitFor(
      () => {
        const raw = localStorage.getItem(keyA);
        expect(raw).not.toBeNull();
        const saved = JSON.parse(raw!) as LocalDraft;
        expect(saved.scores["domain-a"]).toBe(0);
        expect(saved.strengths).toBe("Strong routines");
      },
      { timeout: 4000 },
    );
  });

  it("sends 0.0 score in the API payload when the debounced autosave fires", async () => {
    const keyA = localDraftKey(USER_ID, RUBRIC_ID, "emp-001");
    localStorage.setItem(
      keyA,
      JSON.stringify({
        ...makeDraft("emp-001", ""),
        scores: { "domain-a": 0 },
      }),
    );

    renderPage();

    /* Wait for the score to restore */
    await waitFor(
      () => expect(screen.getByTitle("Not Yet").getAttribute("style")).toContain("rgb(252, 165, 165)"),
      { timeout: 4000 },
    );

    /* Trigger the autosave effect */
    const ta = screen.getByPlaceholderText(
      "What is this teacher doing well?",
    ) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(ta, { target: { value: "Good cold call technique" } });
    });

    /* The debounce timer fires after 2 000 ms; allow up to 5 s total. */
    await waitFor(
      () => {
        expect(vi.mocked(createObservation)).toHaveBeenCalled();
        const payload = vi.mocked(createObservation).mock.calls[0][0] as Record<string, unknown>;
        const scores = payload.scores as Record<string, number>;
        /* 0 is a valid, truthy-false score — it must survive the API payload build. */
        expect(Object.hasOwn(scores, "domain-a")).toBe(true);
        expect(scores["domain-a"]).toBe(0);
      },
      { timeout: 5000 },
    );
  }, 10_000);

  it("preserves 0.0 score in the publish payload when a resumed draft is submitted", async () => {
    /* Simulate resuming a server-side draft (draftId will be set via loadDraftIntoForm).
       Using a server draft rather than localStorage means draftId is populated on the
       React state before submit fires, so doSubmit() takes the updateObservation path
       with status: "published" — the realistic resume-then-submit journey. */
    mockFetchMyDrafts.mockResolvedValue([
      {
        id: "srv-draft-001",
        observedEmployeeId: "emp-001",
        rubricSetId: 7,
        date: "2026-07-13",
        course: "Algebra 1",
        scores: { "domain-a": 0 },
        strengths: "Good technique",
        growthAreas: "",
        isWalkthrough: false,
        status: "draft",
      },
    ]);

    renderPage();

    /* Wait for the server draft to load: the "Not Yet" pill must be selected */
    await waitFor(
      () => expect(screen.getByTitle("Not Yet").getAttribute("style")).toContain("rgb(252, 165, 165)"),
      { timeout: 4000 },
    );

    /* Trigger the form submit */
    const submitBtn = screen.getByRole("button", { name: /Submit/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    /* updateObservation must be called with status "published" and the 0 score intact */
    await waitFor(
      () => {
        expect(vi.mocked(updateObservation)).toHaveBeenCalled();
        const [, payload] = vi.mocked(updateObservation).mock.calls[0];
        expect((payload as Record<string, unknown>).status).toBe("published");
        const scores = (payload as Record<string, unknown>).scores as Record<string, number>;
        expect(Object.hasOwn(scores, "domain-a")).toBe(true);
        expect(scores["domain-a"]).toBe(0);
      },
      { timeout: 4000 },
    );
  });
});
