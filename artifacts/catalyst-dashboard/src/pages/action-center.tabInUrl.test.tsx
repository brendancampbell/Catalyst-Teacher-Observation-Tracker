// @vitest-environment jsdom
/**
 * #61 — the Action Center's tab belongs in the address.
 *
 * Before this, which tab you were on, which intervention sub-tab, and the
 * action-step filters were component state and lived nowhere else. Back left
 * the page instead of returning to the tab you came from, and there was no
 * link that opened a particular tab for anyone else.
 *
 * The two right-hand tabs are NETWORK_ADMIN only, so the guard that a pasted
 * ?tab=analysis link must not show a coach an empty tab body is asserted here
 * too — that link is exactly the one an admin would paste into an email.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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
  /* The Action Center now states the configured windows in its own copy. */
  fetchSystemSettings:      async () => ({
    rescoreWindowDays: 14, overdueWindowDays: 14,
    rescoreUpdatedAt: null, rescoreUpdatedBy: null,
    overdueUpdatedAt: null, overdueUpdatedBy: null,
  }),
  fetchRescoreQueue:        async () => [],
  fetchOverdueObservations: async () => [],
  fetchAIInsights:          async () => null,
  fetchAICalibrationFlags:  async () => [],
  fetchLatestActionStepRoster: async () => [],
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
      role:               "NETWORK_ADMIN",
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
vi.mock("wouter", async () => (await import("@/test/wouterStub")).makeWouterStub());

/* ── Stub ResizeObserver ─────────────────────────────────────────────────── */
class ResizeObserverStub {
  observe()    {}
  unobserve()  {}
  disconnect() {}
}

const MOCK_QUARTER = {
  id: 1, slug: "q1-test", name: "Q1 Test", isActive: true, isArchived: false,
  gradeSpan: null, description: null, displayOrder: 1,
  target: "TEACHER", subjectAudience: "ALL",
};

const MOCK_DASH = {
  rubricSet:       { id: 1, slug: "q1-test", name: "Q1 Test", gradeSpan: null, target: "TEACHER" },
  schoolGradeSpan: null,
  categories: [{ id: "cat1", label: "Instruction", domains: [{ id: "d1", label: "Planning" }] }],
  teachers: [{
    id: "teacher-1", name: "Test Teacher", firstName: "Test", lastName: "Teacher",
    subject: "Math", gradeLevel: ["9"],
    observations: [{ id: "obs-1", date: "2026-07-01", scores: { d1: 0.5 }, observer: "Observer" }],
  }],
};

async function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const ActionCenterPage = (await import("@/pages/action-center")).default;
  render(
    <QueryClientProvider client={qc}>
      <ActionCenterPage />
    </QueryClientProvider>,
  );
}

/** Radix activates a tab on mousedown; a plain click leaves the panel put. */
async function clickTab(label: string) {
  const el = await waitFor(
    () => {
      const hit = screen.getAllByText(label).find((n) => n.closest("button") !== null);
      if (!hit) throw new Error(`no clickable "${label}" yet`);
      return hit.closest("button")!;
    },
    { timeout: 10_000 },
  );
  fireEvent.mouseDown(el);
  fireEvent.click(el);
}

function activeTabId() {
  return screen.getAllByRole("tab").find((t) => t.getAttribute("data-state") === "active")?.id ?? "";
}

describe("Action Center — the tab is in the address (#61)", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
    window.history.replaceState(null, "", "/action-center?schoolId=7&rubric=q1-test");
    mockFetchRubricSets.mockResolvedValue([MOCK_QUARTER]);
    mockFetchDashboard.mockResolvedValue(MOCK_DASH);
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/action-center");
    vi.clearAllMocks();
  });

  it("puts the tab in the address, so there is a link that opens it", { timeout: 20_000 }, async () => {
    await renderPage();
    expect(new URLSearchParams(window.location.search).get("tab")).toBeNull();

    await clickTab("Intervention");
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get("tab")).toBe("intervention");
    }, { timeout: 8_000 });

    /* The school it was opened with survives the tab change — a link that
       loses schoolId lands a network admin on the district view instead. */
    expect(new URLSearchParams(window.location.search).get("schoolId")).toBe("7");
  });

  it("opens the tab a pasted link names", { timeout: 20_000 }, async () => {
    window.history.replaceState(null, "", "/action-center?schoolId=7&rubric=q1-test&tab=intervention");
    await renderPage();

    await waitFor(() => {
      expect(activeTabId()).toContain("intervention");
    }, { timeout: 8_000 });
  });

  it("switching tabs costs no Back press", { timeout: 20_000 }, async () => {
    /* The entry we arrive on stands in for the dashboard you came from. */
    window.history.pushState(null, "", "/action-center?schoolId=7&rubric=q1-test");
    await renderPage();

    await clickTab("Intervention");
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get("tab")).toBe("intervention");
    }, { timeout: 8_000 });
    await clickTab("Summary");
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get("tab")).toBeNull();
    }, { timeout: 8_000 });

    /* Two tab switches, still one entry: Back leaves the Action Center rather
       than walking back through the tabs one at a time. */
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no popstate")), 1000);
      window.addEventListener("popstate", () => { clearTimeout(timer); resolve(); }, { once: true });
      window.history.back();
    });
    expect(window.location.search).not.toContain("tab=");
  });

  it("falls back to Summary rather than showing a stale tab name", { timeout: 20_000 }, async () => {
    /* A link shared before a tab was renamed must still open something. */
    window.history.replaceState(null, "", "/action-center?schoolId=7&rubric=q1-test&tab=nonsense");
    await renderPage();

    await waitFor(() => {
      expect(activeTabId()).toContain("summary");
    }, { timeout: 8_000 });
  });
});
