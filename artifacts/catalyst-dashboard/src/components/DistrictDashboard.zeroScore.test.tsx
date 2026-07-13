// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DistrictSummaryData, RubricSetRow } from "@/lib/api";

/* ── Stubs for sub-components ────────────────────────────────────────────── */
vi.mock("@/components/AppHeader",             () => ({ default: () => null }));
vi.mock("@/components/FilterMultiSelect",     () => ({ FilterMultiSelect: () => null }));
vi.mock("@/components/SchoolObservationModal",() => ({ default: () => null }));
vi.mock("@/components/ImpersonationBanner",   () => ({ default: () => null }));

/* ── Stub UserContext ─────────────────────────────────────────────────────── */
vi.mock("@/context/UserContext", () => ({
  useUser: () => ({
    currentUser: {
      id: 2,
      email: "leader@network.edu",
      name: "Network Leader",
      role: "NETWORK_LEADER",
      schoolId: null,
      schoolName: null,
      schoolAbbreviation: null,
    },
    isLoading: false,
    refetch: async () => {},
    isImpersonating: false,
    realUser: null,
  }),
  UserContext: {},
}));

/* ── Stub ResizeObserver ─────────────────────────────────────────────────── */
class ResizeObserverStub {
  observe()    {}
  unobserve()  {}
  disconnect() {}
}

/* ── Mock data ───────────────────────────────────────────────────────────── */
const RUBRIC_SLUG = "test-rubric";

const MOCK_RUBRIC_SETS: RubricSetRow[] = [
  {
    id:              1,
    slug:            RUBRIC_SLUG,
    name:            "Test Rubric",
    isActive:        true,
    isArchived:      false,
    gradeSpan:       null,
    description:     null,
    displayOrder:    1,
    target:          "TEACHER",
    subjectAudience: "ALL",
  },
];

/* A school whose only domain average is 0.0 — this must render as "0.0", not "—" */
const MOCK_DISTRICT_DATA: DistrictSummaryData = {
  rubricSet:  { id: 1, slug: RUBRIC_SLUG, name: "Test Rubric", gradeSpan: null, target: "TEACHER" },
  categories: [
    {
      id:      "cat1",
      label:   "Instruction",
      domains: [{ id: "d1", label: "Planning" }],
    },
  ],
  schools: [
    {
      id:               1,
      name:             "Zero School",
      abbreviation:     "ZS",
      region:           "Newark",
      gradeSpan:        "ES",
      teacherCount:     5,
      observedCount:    3,
      domainAverages:   { d1: 0 },
      overall:          null,
      lastObservedDate: "2026-07-01",
    },
  ],
};

/* ── Helper: pre-seeded QueryClient ──────────────────────────────────────── */
function makeQueryClient() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  qc.setQueryData(["rubricSets"],                        MOCK_RUBRIC_SETS);
  qc.setQueryData(["district", RUBRIC_SLUG, "recent"],  MOCK_DISTRICT_DATA);
  qc.setQueryData(["district", "",          "recent"],  MOCK_DISTRICT_DATA);
  return qc;
}

/* ── Tests ───────────────────────────────────────────────────────────────── */
describe("DistrictDashboard score grid — 0.0 domain average", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders '0.0' in the domain cell when a school has a 0.0 domain average", async () => {
    const DistrictDashboard = (await import("@/components/DistrictDashboard")).default;
    const qc = makeQueryClient();

    render(
      <QueryClientProvider client={qc}>
        <DistrictDashboard
          activeRubricSet={RUBRIC_SLUG}
          onRubricChange={() => {}}
          onDrillDown={() => {}}
        />
      </QueryClientProvider>,
    );

    await waitFor(
      () => {
        expect(screen.queryAllByText("0.0").length).toBeGreaterThan(0);
      },
      { timeout: 3000 },
    );
  });

  it("does NOT render '—' in place of a 0.0 domain average cell", async () => {
    const DistrictDashboard = (await import("@/components/DistrictDashboard")).default;
    const qc = makeQueryClient();

    const { container } = render(
      <QueryClientProvider client={qc}>
        <DistrictDashboard
          activeRubricSet={RUBRIC_SLUG}
          onRubricChange={() => {}}
          onDrillDown={() => {}}
        />
      </QueryClientProvider>,
    );

    await waitFor(
      () => {
        expect(screen.queryAllByText("0.0").length).toBeGreaterThan(0);
      },
      { timeout: 3000 },
    );

    const cells = container.querySelectorAll("td");
    const allCellTexts = Array.from(cells).map((c) => c.textContent?.trim());

    const has00 = allCellTexts.some((t) => t === "0.0");
    expect(has00).toBe(true);
  });

  it("renders the school name alongside its 0.0 domain score", async () => {
    const DistrictDashboard = (await import("@/components/DistrictDashboard")).default;
    const qc = makeQueryClient();

    render(
      <QueryClientProvider client={qc}>
        <DistrictDashboard
          activeRubricSet={RUBRIC_SLUG}
          onRubricChange={() => {}}
          onDrillDown={() => {}}
        />
      </QueryClientProvider>,
    );

    await waitFor(
      () => {
        expect(screen.queryByText("Zero School")).not.toBeNull();
      },
      { timeout: 3000 },
    );

    expect(screen.getAllByText("0.0").length).toBeGreaterThan(0);
  });
});
