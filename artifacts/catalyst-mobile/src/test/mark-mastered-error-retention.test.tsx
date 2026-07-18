/**
 * Mark as Mastered — network-error retention
 *
 * Verifies that when the observation submit call fails (network error, 5xx,
 * timeout) while masterActionStepId is set, the mastery intent is never
 * silently dropped:
 *
 *   - The "Mark as Mastered" button remains in its marked state after the error.
 *   - The error message explicitly calls out that mastery was not recorded
 *     and instructs the user to retry.
 *   - On retry, masterActionStepId is included in the payload again.
 *
 * Covers both paths in doSubmit():
 *   PUT  — an existing draft is resumed (updateObservation → status: "published")
 *   POST — a new observation is submitted directly (apiFetch POST)
 */

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ObservationPage from "@/pages/observation";
import { createObservation, updateObservation } from "@/lib/api";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: 42,
      role: "SCHOOL_LEADER",
      schoolId: 1,
      schoolName: "Test School",
      name: "Principal Test",
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
  name: "Alice Smith",
  department: "Math",
  isActive: true,
};

const RUBRIC_DATA = {
  rubricSet: { id: 7, slug: "default", name: "Test Rubric" },
  categories: [],
};

const OPEN_ACTION_STEP = {
  id: 55,
  teacherEmployeeId: "emp-001",
  assignedByEmployeeId: "emp-admin",
  assignedByName: "Admin User",
  text: "Use cold-call technique daily",
  dueDate: "2026-08-15",
  status: "open",
  createdAt: new Date("2026-06-01").toISOString(),
  assignedAt: new Date("2026-06-01").toISOString(),
};

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

/**
 * Wait until the "Mark as Mastered" button appears (requires lastActionStep
 * to have loaded and be open), then return it.
 */
async function waitForMasteredButton(): Promise<HTMLElement> {
  return waitFor(
    () => screen.getByRole("button", { name: /Mark as Mastered/i }),
    { timeout: 5000 },
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Returns true when the mastery button shows the "marked" text */
function isMasteredButtonActive(): boolean {
  const btn = screen.queryByRole("button", { name: /Marked as Mastered/i });
  return btn !== null;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Mark as Mastered — retained after network error on PUT (draft → published) path", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();

    /* Server returns a resumable draft → doSubmit() takes the updateObservation path */
    mockFetchMyDrafts.mockResolvedValue([
      {
        id: "srv-draft-001",
        observedEmployeeId: "emp-001",
        rubricSetId: 7,
        date: "2026-07-18",
        course: "Algebra 1",
        scores: {},
        strengths: "Good technique",
        growthAreas: "",
        isWalkthrough: false,
        status: "draft",
      },
    ]);

    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes("/api/people")) return Promise.resolve([TEACHER_A]);
      if (url.includes("/api/rubric")) return Promise.resolve(RUBRIC_DATA);
      if (url.includes("/api/action-steps/latest")) return Promise.resolve(OPEN_ACTION_STEP);
      return Promise.resolve({});
    });

    /* First submit throws; second succeeds — simulates a retry after network error */
    vi.mocked(updateObservation)
      .mockRejectedValueOnce(new Error("Failed to save observation"))
      .mockResolvedValue({ id: "srv-draft-001" } as never);

    vi.mocked(createObservation).mockResolvedValue({ id: "srv-draft-001" } as never);
  });

  it("keeps Mark as Mastered in the marked state after PUT fails with a network error", async () => {
    renderPage();

    const btn = await waitForMasteredButton();

    /* Click to mark as mastered — button text changes to "Marked as Mastered" */
    await act(async () => { fireEvent.click(btn); });
    expect(screen.getByRole("button", { name: /Marked as Mastered/i })).toBeTruthy();

    /* Submit — updateObservation throws */
    const submitBtn = screen.getByRole("button", { name: /Submit/i });
    await act(async () => { fireEvent.click(submitBtn); });

    /* Error must appear */
    await waitFor(
      () => expect(screen.getByText(/Failed to save observation/i)).toBeTruthy(),
      { timeout: 4000 },
    );

    /* Mastery toggle must remain in the "Marked as Mastered" state */
    expect(isMasteredButtonActive()).toBe(true);
  });

  it("includes masterActionStepId in the PUT retry payload after an initial failure", async () => {
    renderPage();

    const btn = await waitForMasteredButton();
    await act(async () => { fireEvent.click(btn); });
    expect(screen.getByRole("button", { name: /Marked as Mastered/i })).toBeTruthy();

    const submitBtn = screen.getByRole("button", { name: /Submit/i });

    /* First submit — fails */
    await act(async () => { fireEvent.click(submitBtn); });
    await waitFor(
      () => expect(screen.getByText(/Failed to save observation/i)).toBeTruthy(),
      { timeout: 4000 },
    );

    /* Retry — succeeds */
    await act(async () => { fireEvent.click(submitBtn); });
    await waitFor(
      () => expect(vi.mocked(updateObservation)).toHaveBeenCalledTimes(2),
      { timeout: 4000 },
    );

    const [, retryPayload] = vi.mocked(updateObservation).mock.calls[1];
    expect((retryPayload as Record<string, unknown>).masterActionStepId).toBe(55);
    expect((retryPayload as Record<string, unknown>).status).toBe("published");
  });

  it("shows a mastery-specific warning in the error message on PUT failure", async () => {
    renderPage();

    const btn = await waitForMasteredButton();
    await act(async () => { fireEvent.click(btn); });

    const submitBtn = screen.getByRole("button", { name: /Submit/i });
    await act(async () => { fireEvent.click(submitBtn); });

    await waitFor(
      () => {
        /* Must mention the mastery flag and tell the user it will be re-sent on retry */
        const errorText = screen.getByText(/Mark as Mastered.*not saved/i);
        expect(errorText).toBeTruthy();
      },
      { timeout: 4000 },
    );
  });
});

describe("Mark as Mastered — retained after network error on POST (new observation) path", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();

    /* No server draft → doSubmit() takes the apiFetch POST path */
    mockFetchMyDrafts.mockResolvedValue([]);

    /* Auto-save creates a server draft; resolve immediately so tests that do
       not interact with form content avoid waiting on the 2-second debounce */
    vi.mocked(createObservation).mockResolvedValue({ id: "auto-draft-001" } as never);
    vi.mocked(updateObservation).mockResolvedValue({ id: "auto-draft-001" } as never);
  });

  /* Build a fresh apiFetch mock per test so POST call-count resets cleanly */
  function setupPostMock(opts: { failFirstPost?: boolean } = {}) {
    let postCallCount = 0;
    mockApiFetch.mockImplementation((url: string, fetchOpts?: { method?: string; body?: string }) => {
      if (url.includes("/api/people")) return Promise.resolve([TEACHER_A]);
      if (url.includes("/api/rubric")) return Promise.resolve(RUBRIC_DATA);
      if (url.includes("/api/action-steps/latest")) return Promise.resolve(OPEN_ACTION_STEP);
      if (url.includes("/api/observations") && fetchOpts?.method === "POST") {
        postCallCount += 1;
        if (opts.failFirstPost && postCallCount === 1) {
          return Promise.reject(new Error("Failed to save observation"));
        }
        return Promise.resolve({ id: "new-obs-001" });
      }
      return Promise.resolve({});
    });
    return { getPostCallCount: () => postCallCount };
  }

  it("keeps Mark as Mastered in the marked state after POST fails with a network error", async () => {
    setupPostMock({ failFirstPost: true });
    renderPage();

    /* Wait for the "Mark as Mastered" button (requires lastActionStep loaded) */
    const btn = await waitForMasteredButton();

    /* Click to mark — hasContent is still false, so auto-save does not update
       draftId; the submit will go through the POST path */
    await act(async () => { fireEvent.click(btn); });
    expect(screen.getByRole("button", { name: /Marked as Mastered/i })).toBeTruthy();

    const submitBtn = screen.getByRole("button", { name: /Submit/i });
    await act(async () => { fireEvent.click(submitBtn); });

    await waitFor(
      () => expect(screen.getByText(/Failed to save observation/i)).toBeTruthy(),
      { timeout: 4000 },
    );

    /* Mastery toggle must remain in the "Marked as Mastered" state */
    expect(isMasteredButtonActive()).toBe(true);
  });

  it("shows a mastery-specific warning in the POST failure error message", async () => {
    setupPostMock({ failFirstPost: true });
    renderPage();

    const btn = await waitForMasteredButton();
    await act(async () => { fireEvent.click(btn); });

    const submitBtn = screen.getByRole("button", { name: /Submit/i });
    await act(async () => { fireEvent.click(submitBtn); });

    await waitFor(
      () => {
        const errorText = screen.getByText(/Mark as Mastered.*not saved/i);
        expect(errorText).toBeTruthy();
      },
      { timeout: 4000 },
    );
  });

  it("includes masterActionStepId in the POST retry payload after an initial failure", async () => {
    const { getPostCallCount } = setupPostMock({ failFirstPost: true });
    renderPage();

    const btn = await waitForMasteredButton();
    await act(async () => { fireEvent.click(btn); });

    const submitBtn = screen.getByRole("button", { name: /Submit/i });

    /* First POST — fails */
    await act(async () => { fireEvent.click(submitBtn); });
    await waitFor(
      () => expect(screen.getByText(/Failed to save observation/i)).toBeTruthy(),
      { timeout: 4000 },
    );

    /* Retry POST — verify masterActionStepId was sent */
    await act(async () => { fireEvent.click(submitBtn); });

    await waitFor(
      () => {
        const postCalls = mockApiFetch.mock.calls.filter(
          ([url, opts]: [string, { method?: string }]) =>
            url.includes("/api/observations") && opts?.method === "POST",
        );
        /* Both the failing call and the retry must have been made */
        expect(postCalls.length).toBe(2);
        const retryBody = JSON.parse(postCalls[1][1].body as string) as Record<string, unknown>;
        expect(retryBody.masterActionStepId).toBe(55);
      },
      { timeout: 4000 },
    );

    expect(getPostCallCount()).toBe(2);
  });
});
