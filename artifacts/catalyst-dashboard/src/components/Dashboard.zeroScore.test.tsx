// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DashboardData, RubricSetRow } from "@/lib/api";

/* ── Stubs for complex sub-components ────────────────────────────────────── */
vi.mock("@/components/AppHeader",          () => ({ default: () => null }));
vi.mock("@/components/FilterMultiSelect",  () => ({ FilterMultiSelect: () => null }));
vi.mock("@/components/NewObservationModal",() => ({ NewObservationModal: () => null }));
vi.mock("@/components/DrillDownModal",     () => ({ DrillDownModal: () => null }));
vi.mock("@/components/TeacherScoreOverlay", () => ({ TeacherScoreOverlay: () => null }));
vi.mock("@/components/DistrictDashboard",  () => ({ default: () => null }));
vi.mock("@/components/ImpersonationBanner",() => ({ default: () => null }));

/* ── Stub UserContext ─────────────────────────────────────────────────────── */
vi.mock("@/context/UserContext", () => ({
  useUser: () => ({
    currentUser: {
      id: 1,
      email: "coach@school.edu",
      name: "Test Coach",
      role: "SCHOOL_LEADER",
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

/* ── Stub wouter ─────────────────────────────────────────────────────────── */
vi.mock("wouter", () => ({
  useSearch: () => "",
  useLocation: () => ["/", vi.fn()],
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

/* ── Stub ResizeObserver (not available in jsdom) ────────────────────────── */
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

const MOCK_DASHBOARD_DATA: DashboardData = {
  rubricSet: { id: 1, slug: RUBRIC_SLUG, name: "Test Rubric", gradeSpan: null, target: "TEACHER" },
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
      id:           "teacher-zero",
      name:         "Zero Score",
      firstName:    "Zero",
      lastName:     "Score",
      subject:      "Math",
      gradeLevel:   ["9"],
      observations: [
        {
          id:       "obs-1",
          date:     "2026-07-01",
          scores:   { d1: 0 },
          observer: "Test Observer",
        },
      ],
    },
  ],
};

/* ── Helper: build a pre-seeded QueryClient ──────────────────────────────── */
function makeQueryClient() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  qc.setQueryData(["rubricSets"],                                        MOCK_RUBRIC_SETS);
  qc.setQueryData(["myLatestRubricSlug"],                                RUBRIC_SLUG);
  qc.setQueryData(["dashboard", RUBRIC_SLUG, null, false],              MOCK_DASHBOARD_DATA);
  qc.setQueryData(["dashboard", "",           null, false],              MOCK_DASHBOARD_DATA);
  return qc;
}

/* ── Tests ───────────────────────────────────────────────────────────────── */
describe("Dashboard score grid — 0.0 observation score", () => {
  beforeEach(() => {
    localStorage.setItem("catalyst:activeRubricSet", RUBRIC_SLUG);
    (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders '0.0' in a score cell when a teacher has a 0.0 domain score", async () => {
    const Dashboard = (await import("@/components/Dashboard")).default;
    const qc = makeQueryClient();

    render(
      <QueryClientProvider client={qc}>
        <Dashboard />
      </QueryClientProvider>,
    );

    await waitFor(
      () => {
        expect(screen.queryAllByText("0.0").length).toBeGreaterThan(0);
      },
      { timeout: 3000 },
    );
  });

  it("does NOT render '—' in place of a 0.0 score cell for the scored domain", async () => {
    const Dashboard = (await import("@/components/Dashboard")).default;
    const qc = makeQueryClient();

    const { container } = render(
      <QueryClientProvider client={qc}>
        <Dashboard />
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

  it("renders the teacher name alongside the 0.0 score", async () => {
    const Dashboard = (await import("@/components/Dashboard")).default;
    const qc = makeQueryClient();

    render(
      <QueryClientProvider client={qc}>
        <Dashboard />
      </QueryClientProvider>,
    );

    await waitFor(
      () => {
        expect(screen.queryByText("Zero Score")).not.toBeNull();
      },
      { timeout: 3000 },
    );

    expect(screen.getAllByText("0.0").length).toBeGreaterThan(0);
  });
});
