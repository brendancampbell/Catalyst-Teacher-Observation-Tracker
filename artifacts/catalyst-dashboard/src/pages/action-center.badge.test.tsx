// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/* ── Hoisted mocks so factory functions can reference them ─────────────────
 * vi.mock() factories are hoisted before all variable declarations.
 * vi.hoisted() lets us declare values that the factory can safely reference.
 * ─────────────────────────────────────────────────────────────────────────── */
const {
  mockFetchDashboard,
  mockFetchRubricSets,
} = vi.hoisted(() => ({
  mockFetchDashboard: vi.fn(),
  mockFetchRubricSets: vi.fn(),
}));

/* ── Stub @/lib/api ───────────────────────────────────────────────────────── */
vi.mock("@/lib/api", () => ({
  fetchDashboard:           mockFetchDashboard,
  fetchRubricSets:          mockFetchRubricSets,
  fetchRescoreQueue:        async () => [],
  fetchOverdueObservations: async () => [],
  fetchAIInsights:          async () => null,
  fetchAICalibrationFlags:  async () => [],
  fetchOverdueActionSteps:  async () => [],
  fetchDistrictSummary:     async () => null,
  fetchNetworkAverages:     async () => null,
  fetchChatSessions:        async () => [],
  createChatSession:        async () => ({ id: "s1", title: "Session", createdAt: "" }),
  fetchChatSessionMessages: async () => [],
  streamAIChat:             async () => {},
  generateAIAnalysis:       async () => null,
  renameChatSession:        async () => {},
  deleteChatSession:        async () => {},
  createObservation:        async () => ({}),
  fetchAIQuotaStatus:       async () => ({ tokensUsed: 0, tokensLimit: 1000, windowEndsAt: "" }),
  setQuotaExhaustedHandler: vi.fn(),
}));

/* ── Stub heavy sub-components ────────────────────────────────────────────── */
vi.mock("@/components/AppHeader",          () => ({ default: () => null }));
vi.mock("@/components/NewObservationModal",() => ({ NewObservationModal: () => null }));

/* ── Stub UserContext ─────────────────────────────────────────────────────── */
vi.mock("@/context/UserContext", () => ({
  useUser: () => ({
    currentUser: {
      id:                 1,
      email:              "leader@school.edu",
      name:               "Test Leader",
      role:               "SCHOOL_LEADER",
      schoolId:           5,
      schoolName:         "Test School",
      schoolAbbreviation: "TS",
    },
    isLoading:       false,
    refetch:         async () => {},
    isImpersonating: false,
    realUser:        null,
  }),
  UserContext: {},
}));

/* ── Stub wouter ─────────────────────────────────────────────────────────── */
vi.mock("wouter", () => ({
  useSearch:   () => "",
  useLocation: () => ["/action-center", vi.fn()],
  Link:        ({ children }: { children: React.ReactNode }) => children,
}));

/* ── Stub ResizeObserver ─────────────────────────────────────────────────── */
class ResizeObserverStub {
  observe()    {}
  unobserve()  {}
  disconnect() {}
}

/* ── Shared test data ────────────────────────────────────────────────────── */
const MOCK_QUARTER = {
  id:              1,
  slug:            "q1-test",
  name:            "Q1 Test",
  isActive:        true,
  isArchived:      false,
  gradeSpan:       null,
  description:     null,
  displayOrder:    1,
  target:          "TEACHER",
  subjectAudience: "ALL",
};

function makeDashData(domainScore: number) {
  return {
    rubricSet:       { id: 1, slug: "q1-test", name: "Q1 Test", gradeSpan: null, target: "TEACHER" },
    schoolGradeSpan: null,
    categories: [
      {
        id:      "cat1",
        label:   "Instruction",
        domains: [{ id: "d1", label: "Planning" }],
      },
    ],
    teachers: [
      {
        id:           "teacher-1",
        name:         "Test Teacher",
        firstName:    "Test",
        lastName:     "Teacher",
        subject:      "Math",
        gradeLevel:   ["9"],
        observations: [
          {
            id:       "obs-1",
            date:     "2026-07-01",
            scores:   { d1: domainScore },
            observer: "Observer",
          },
        ],
      },
    ],
  };
}

/* ── Helper: build a QueryClient pre-seeded with both possible activeQuarter
 *   values ("Q1" fallback + real "q1-test") so the badge renders immediately
 *   on first render regardless of which key the component uses.
 * ─────────────────────────────────────────────────────────────────────────── */
function makeQueryClient(domainScore: number) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  qc.setQueryData(["quarters"],                        [MOCK_QUARTER]);
  qc.setQueryData(["dashboard", "Q1",      null],     makeDashData(domainScore));
  qc.setQueryData(["dashboard", "q1-test", null],     makeDashData(domainScore));
  return qc;
}

/* ── Tests ───────────────────────────────────────────────────────────────── */
describe("Action Center summary tab — school-average badge label", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
    mockFetchRubricSets.mockResolvedValue([MOCK_QUARTER]);
    mockFetchDashboard.mockImplementation(async (_slug: string, _schoolId: number | null) =>
      makeDashData(0.5),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows 'Not Proficient' badge when school average is below 0.7", { timeout: 12_000 }, async () => {
    const qc = makeQueryClient(0.5);
    const ActionCenterPage = (await import("@/pages/action-center")).default;

    render(
      <QueryClientProvider client={qc}>
        <ActionCenterPage />
      </QueryClientProvider>,
    );

    await waitFor(
      () => {
        expect(screen.queryAllByText("Not Proficient").length).toBeGreaterThan(0);
      },
      { timeout: 8_000 },
    );
  });

  it("does NOT show 'Not Yet' when school average is below 0.7", { timeout: 12_000 }, async () => {
    const qc = makeQueryClient(0.5);
    const ActionCenterPage = (await import("@/pages/action-center")).default;

    render(
      <QueryClientProvider client={qc}>
        <ActionCenterPage />
      </QueryClientProvider>,
    );

    await waitFor(
      () => {
        expect(screen.queryAllByText("Not Proficient").length).toBeGreaterThan(0);
      },
      { timeout: 8_000 },
    );

    expect(screen.queryAllByText("Not Yet").length).toBe(0);
  });

  it("shows 'Proficient' (not 'Not Proficient') when school average is at or above 0.7", { timeout: 12_000 }, async () => {
    mockFetchDashboard.mockResolvedValue(makeDashData(0.85));
    const qc = makeQueryClient(0.85);
    const ActionCenterPage = (await import("@/pages/action-center")).default;

    render(
      <QueryClientProvider client={qc}>
        <ActionCenterPage />
      </QueryClientProvider>,
    );

    await waitFor(
      () => {
        expect(screen.queryAllByText("Proficient").length).toBeGreaterThan(0);
      },
      { timeout: 8_000 },
    );

    expect(screen.queryAllByText("Not Proficient").length).toBe(0);
    expect(screen.queryAllByText("Not Yet").length).toBe(0);
  });
});
