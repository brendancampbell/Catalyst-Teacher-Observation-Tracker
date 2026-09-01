// @vitest-environment jsdom
/**
 * The teacher links in the Action Center must carry the school they were opened
 * with.
 *
 * Failure mode prevented: the href is built as a bare `/?teacher=<id>`. The
 * profile is an overlay the dashboard renders, not a route — so reaching it
 * means landing on the right dashboard first. For a NETWORK_ADMIN, `/` with no
 * schoolId is the DISTRICT dashboard, which returns before any teacher is
 * looked up. The profile never opens and the click reads as "it just went to
 * the dashboard".
 *
 * Asserted on the rendered anchor rather than on the helper alone, because the
 * bug was never in the helper — it was in the two call sites not using one.
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { mockFetchRescoreQueue, mockFetchLatestActionStepRoster } = vi.hoisted(() => ({
  mockFetchRescoreQueue:          vi.fn(),
  mockFetchLatestActionStepRoster: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  fetchDashboard:           async () => MOCK_DASH,
  fetchRubricSets:          async () => [MOCK_QUARTER],
  fetchSystemSettings:      async () => ({
    rescoreWindowDays: 14, overdueWindowDays: 14,
    rescoreUpdatedAt: null, rescoreUpdatedBy: null,
    overdueUpdatedAt: null, overdueUpdatedBy: null,
  }),
  fetchRescoreQueue:           mockFetchRescoreQueue,
  fetchOverdueObservations:    async () => [],
  fetchAIInsights:             async () => null,
  fetchAICalibrationFlags:     async () => [],
  fetchLatestActionStepRoster: mockFetchLatestActionStepRoster,
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
  fetchAIQuotaStatus:       async () => ({
    tokensUsed: 0, tokensLimit: 1000, windowEndsAt: "", remaining: 1000,
    chat:       { remaining: 1000, windowRemaining: 1000, hasGrant: true },
    generation: { remaining: 1000, windowRemaining: 1000, hasGrant: true },
  }),
  setQuotaExhaustedHandler: vi.fn(),
}));

vi.mock("@/components/AppHeader",           () => ({ default: () => null }));
vi.mock("@/components/NewObservationModal", () => ({ NewObservationModal: () => null }));

/* A network admin: their own school is Home Office, so the fallback cannot
   save this link. Only the schoolId in the URL can. */
vi.mock("@/context/UserContext", () => ({
  useUser: () => ({
    currentUser: {
      id: 2, email: "admin@network.org", name: "Test Admin",
      role: "NETWORK_ADMIN", schoolId: null, schoolName: null, schoolAbbreviation: null,
    },
    isLoading: false, refetch: async () => {}, isImpersonating: false, realUser: null,
  }),
  UserContext: {},
}));

/* Reads the live URL — the helper under test builds from window.location. */
vi.mock("wouter", () => ({
  useSearch:   () => window.location.search.replace(/^\?/, ""),
  useLocation: () => ["/action-center", vi.fn()],
  Link:        ({ children }: { children: React.ReactNode }) => children,
}));

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }

const MOCK_QUARTER = {
  id: 1, slug: "q1-test", name: "Q1 Test", isActive: true, isArchived: false,
  gradeSpan: null, description: null, displayOrder: 1,
  target: "TEACHER", subjectAudience: "ALL",
};

const MOCK_DASH = {
  rubricSet: { id: 1, slug: "q1-test", name: "Q1 Test", gradeSpan: null, target: "TEACHER" },
  schoolGradeSpan: null,
  categories: [{ id: "cat1", label: "Instruction", domains: [{ id: "d1", label: "Planning" }] }],
  teachers: [],
};

const EMPLOYEE_ID = "UCS-004821";

const ROSTER_ROW = {
  employeeId: EMPLOYEE_ID, teacherName: "Samra Djokovic",
  department: "English", gradeLevel: ["11"], schoolName: "Test Prep",
  hasOverdueStep: false, latestStep: null,
};

const RESCORE_ITEM = {
  employeeId: EMPLOYEE_ID, teacherName: "Samra Djokovic",
  department: "English", gradeLevel: ["11"], schoolName: "Test Prep",
  rescoreDueDate: "2026-09-10", needsRescore: true,
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  return import("@/pages/action-center").then(({ default: ActionCenterPage }) => {
    render(
      <QueryClientProvider client={qc}>
        <ActionCenterPage />
      </QueryClientProvider>,
    );
  });
}

/* The sub-tabs live under the Intervention tab, which is not the default.
   Each label also appears as the section heading once its tab is open, so the
   clickable one is picked by tag rather than by being the only match. */
async function clickControl(label: string) {
  const el = await waitFor(
    () => {
      const hit = screen.getAllByText(label)
        .find((n) => n.closest("button") !== null);
      if (!hit) throw new Error(`no clickable "${label}" yet`);
      return hit.closest("button")!;
    },
    { timeout: 10_000 },
  );
  /* Radix activates a tab on mousedown, not click; a plain click leaves the
     panel on whatever was already showing. */
  fireEvent.mouseDown(el);
  fireEvent.click(el);
}

async function openInterventionTab(label: string) {
  await clickControl("Intervention");
  await clickControl(label);
}

describe("Action Center teacher links — school context", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
    /* Drilled into school 7, exactly as a network admin arrives here. */
    window.history.replaceState(null, "", "/action-center?schoolId=7&rubric=q1-test");
    mockFetchRescoreQueue.mockResolvedValue([RESCORE_ITEM]);
    mockFetchLatestActionStepRoster.mockResolvedValue([ROSTER_ROW]);
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/action-center");
    vi.clearAllMocks();
  });

  it("keeps schoolId on the Latest Action Step tab's teacher link", { timeout: 20_000 }, async () => {
    await renderPage();
    await openInterventionTab("Latest Action Step");

    const link = await screen.findByRole("link", { name: "Samra Djokovic" }, { timeout: 8_000 });
    const href = link.getAttribute("href") ?? "";
    const params = new URLSearchParams(href.split("?")[1]);

    expect(params.get("teacher")).toBe(EMPLOYEE_ID);
    expect(params.get("schoolId")).toBe("7");
  });

  it("keeps schoolId on the Rescore Queue's teacher link", { timeout: 20_000 }, async () => {
    await renderPage();
    await openInterventionTab("Rescore Queue");

    const link = await screen.findByRole("link", { name: "Samra Djokovic" }, { timeout: 8_000 });
    const href = link.getAttribute("href") ?? "";
    const params = new URLSearchParams(href.split("?")[1]);

    expect(params.get("teacher")).toBe(EMPLOYEE_ID);
    expect(params.get("schoolId")).toBe("7");
  });
});
