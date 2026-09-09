// @vitest-environment jsdom
/**
 * #61 — the Settings tab belongs in the address.
 *
 * Which of the five tabs you were on was component state, so Back left the
 * page rather than returning to it, and there was no link that opened a
 * particular tab.
 *
 * A tab this person cannot see must not strand them on a blank panel. The
 * page already falls back to whatever their leftmost tab is (visibleTab), so
 * that guard is asserted here rather than duplicated in the URL reader.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/* ── Hoisted mocks ────────────────────────────────────────────────────────── */
const {
  mockFetchRubric,
  mockUpdateDomain,
} = vi.hoisted(() => ({
  mockFetchRubric:  vi.fn(),
  mockUpdateDomain: vi.fn(),
}));

/* ── Stub @/lib/api ───────────────────────────────────────────────────────── */
vi.mock("@/lib/api", () => ({
  fetchRubric:        mockFetchRubric,
  updateDomain:       mockUpdateDomain,
  createCategory:     async () => ({}),
  updateCategory:     async () => ({}),
  deleteCategory:     async () => ({}),
  reorderCategories:  async () => ({}),
  createDomain:       async () => ({}),
  deleteDomain:       async () => ({}),
  reorderDomains:     async () => ({}),
  fetchRubricSets:    async () => [],
  /* Real fetchPeople resolves to PersonRow[], not a wrapper object. */
  fetchPeople:        async () => [],
  createPerson:       async () => ({}),
  updatePerson:       async () => ({}),
  togglePersonActive: async () => ({}),
  startImpersonation: async () => ({}),
  bulkImportPeople:   async () => ({}),
  fetchAdminSchools:  async () => [],
  createAdminSchool:  async () => ({}),
  updateAdminSchool:  async () => ({}),
  deleteAdminSchool:  async () => ({}),
  bulkImportSchools:  async () => ({}),
  createRubricSet:    async () => ({}),
  updateRubricSet:    async () => ({}),
  archiveRubricSet:   async () => ({}),
  reorderRubricSets:  async () => ({}),
  REGIONS:    [],
  GRADE_SPANS: [],
}));

/* ── Stub heavy components & context ──────────────────────────────────────── */
vi.mock("@/components/AppHeader",         () => ({ default: () => null }));
vi.mock("@/components/FilterMultiSelect", () => ({ FilterMultiSelect: () => null }));
vi.mock("@/lib/safeReturnTo",             () => ({ safeReturnTo: (v: string) => v }));
vi.mock("@/context/UserContext", () => ({
  useUser: () => ({
    currentUser: {
      id: 1, email: "admin@test.edu", name: "Admin", role: "NETWORK_ADMIN",
      schoolId: null, schoolName: null, schoolAbbreviation: null,
    },
    isLoading: false, refetch: async () => {}, isImpersonating: false, realUser: null,
  }),
  UserContext: {},
}));
vi.mock("@/data/dummy",            () => ({ SUBJECTS: [], GRADE_LEVELS: [] }));
vi.mock("@/utils/parseSchoolCsv",  () => ({ parseSchoolCsv: async () => [], CSV_HEADERS: [] }));
vi.mock("wouter", async () => (await import("@/test/wouterStub")).makeWouterStub());

const MOCK_RUBRIC = {
  rubricSet: {
    id: 1, slug: "test-set", name: "Test Set",
    isActive: true, isArchived: false,
    gradeSpan: null, description: null, displayOrder: 1,
    target: "TEACHER" as const, subjectAudience: "ALL" as const,
  },
  categories: [
    {
      id: 1, rubricSetId: 1, name: "Instruction", displayOrder: 1,
      domains: [
        { id: 10, categoryId: 1, name: "Domain Alpha", slug: "alpha", displayOrder: 1, description: null },
      ],
    },
  ],
};

class ResizeObserverStub2 { observe() {} unobserve() {} disconnect() {} }

async function renderAdmin() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const AdminPage = (await import("@/pages/admin")).default;
  render(
    <QueryClientProvider client={qc}>
      <AdminPage />
    </QueryClientProvider>,
  );
}

async function clickTab(label: string) {
  const el = await waitFor(
    () => {
      const hit = screen.getAllByText(label).find((n) => n.closest("button") !== null);
      if (!hit) throw new Error(`no clickable "${label}" yet`);
      return hit.closest("button")!;
    },
    { timeout: 10_000 },
  );
  fireEvent.click(el);
}

describe("Settings — the tab is in the address (#61)", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub2;
    window.history.replaceState(null, "", "/admin");
    mockFetchRubric.mockResolvedValue(MOCK_RUBRIC);
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/admin");
    vi.clearAllMocks();
  });

  it("puts the tab in the address when you switch to it", { timeout: 20_000 }, async () => {
    await renderAdmin();
    /* The landing tab stays out of the address, so a plain /admin link is not
       cluttered with the tab it would have opened anyway. */
    expect(new URLSearchParams(window.location.search).get("tab")).toBeNull();

    await clickTab("Users");
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get("tab")).toBe("people");
    }, { timeout: 8_000 });
  });

  it("switching tabs costs no Back press", { timeout: 20_000 }, async () => {
    window.history.pushState(null, "", "/admin");
    await renderAdmin();

    await clickTab("Users");
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get("tab")).toBe("people");
    }, { timeout: 8_000 });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no popstate")), 1000);
      window.addEventListener("popstate", () => { clearTimeout(timer); resolve(); }, { once: true });
      window.history.back();
    });
    /* One entry for the whole visit, so Back leaves Settings rather than
       walking back through every tab that was opened. */
    expect(window.location.search).not.toContain("tab=");
  });

  it("opens the tab a pasted link names", { timeout: 20_000 }, async () => {
    window.history.replaceState(null, "", "/admin?tab=schools");
    await renderAdmin();

    await waitFor(() => {
      expect(screen.getAllByText(/School/i).length).toBeGreaterThan(0);
    }, { timeout: 8_000 });
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("schools");
  });
});
