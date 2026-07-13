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
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ObservationPage, { localDraftKey } from "@/pages/observation";
import type { LocalDraft } from "@/pages/observation";

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
