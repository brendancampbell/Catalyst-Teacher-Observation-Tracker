// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
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
  fetchPeople:        async () => ({ people: [], total: 0 }),
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
vi.mock("wouter", () => ({
  useSearch:   () => "",
  useLocation: () => ["/admin", vi.fn()],
  Link:        ({ children }: { children: React.ReactNode }) => children,
}));

/* ── Stub ResizeObserver ─────────────────────────────────────────────────── */
class ResizeObserverStub {
  observe()    {}
  unobserve()  {}
  disconnect() {}
}

/* ── Shared fixture ──────────────────────────────────────────────────────── */
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
        { id: 20, categoryId: 1, name: "Domain Beta",  slug: "beta",  displayOrder: 2, description: null },
      ],
    },
  ],
};

function makeQC() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

async function renderRubricSettings() {
  const { RubricSettings } = await import("@/pages/admin");
  const qc = makeQC();
  render(
    <QueryClientProvider client={qc}>
      <RubricSettings setSlug="test-set" />
    </QueryClientProvider>,
  );
}

/* Helper: find all buttons whose only direct child is an SVG (icon buttons) */
function iconButtons() {
  return Array.from(document.querySelectorAll("button")).filter(
    (b) => b.querySelector("svg"),
  );
}

/** Edit (pencil) buttons are the ones with class `hover:text-blue-600` */
function editPencilButtons() {
  return Array.from(document.querySelectorAll("button")).filter(
    (b) => b.className.includes("hover:text-blue-600"),
  );
}

/** Save (check) button inside the edit form — has class `text-green-600` */
function saveButton() {
  return Array.from(document.querySelectorAll("button")).find(
    (b) => b.className.includes("text-green-600"),
  ) ?? null;
}

/** Cancel (X) button inside the edit form — has class `hover:text-slate-600` (within the edit row) */
function cancelButton() {
  return Array.from(document.querySelectorAll("button")).find(
    (b) => b.className.includes("hover:text-slate-600") && b.querySelector("svg"),
  ) ?? null;
}

/* ── Tests ───────────────────────────────────────────────────────────────── */
describe("RubricSettings — slug error does not bleed between domain edit forms", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
    mockFetchRubric.mockResolvedValue(MOCK_RUBRIC);
    mockUpdateDomain.mockRejectedValue(new Error("A domain with that slug already exists (409)."));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it(
    "opening domain B's edit form clears any 409 error left over from domain A",
    { timeout: 15_000 },
    async () => {
      await renderRubricSettings();

      await waitFor(
        () => expect(screen.queryAllByText("Domain Alpha").length).toBeGreaterThan(0),
        { timeout: 8_000 },
      );

      const [pencilA] = editPencilButtons();
      expect(pencilA).toBeTruthy();
      fireEvent.click(pencilA);

      await waitFor(
        () => expect(screen.queryAllByText("Domain name").length + document.querySelectorAll("input[placeholder='Domain name']").length).toBeGreaterThan(0),
        { timeout: 4_000 },
      );

      const save = saveButton();
      expect(save).toBeTruthy();
      await act(async () => { fireEvent.click(save!); });

      await waitFor(
        () => expect(screen.queryAllByText(/already exists/i).length).toBeGreaterThan(0),
        { timeout: 4_000 },
      );

      const [pencilB] = editPencilButtons();
      expect(pencilB).toBeTruthy();
      fireEvent.click(pencilB);

      await waitFor(
        () => expect(screen.queryAllByText(/already exists/i).length).toBe(0),
        { timeout: 4_000 },
      );

      /* Slug is now shown as a read-only <code> badge — not an editable input */
      const codeBadges = Array.from(document.querySelectorAll("code"));
      expect(codeBadges.some((c) => c.textContent === "beta")).toBe(true);
    },
  );

  it(
    "cancelling domain A's edit form clears the slug error so it cannot bleed into domain B's edit form",
    { timeout: 15_000 },
    async () => {
      await renderRubricSettings();

      await waitFor(
        () => expect(screen.queryAllByText("Domain Alpha").length).toBeGreaterThan(0),
        { timeout: 8_000 },
      );

      const [pencilA] = editPencilButtons();
      fireEvent.click(pencilA);

      await waitFor(
        () => expect(document.querySelectorAll("input[placeholder='Domain name']").length).toBeGreaterThan(0),
        { timeout: 4_000 },
      );

      const save = saveButton();
      await act(async () => { fireEvent.click(save!); });

      await waitFor(
        () => expect(screen.queryAllByText(/already exists/i).length).toBeGreaterThan(0),
        { timeout: 4_000 },
      );

      const cancel = cancelButton();
      expect(cancel).toBeTruthy();
      fireEvent.click(cancel!);

      await waitFor(
        () => expect(document.querySelectorAll("input[placeholder='Domain name']").length).toBe(0),
        { timeout: 4_000 },
      );

      /* Now open domain B's edit form — the error must not bleed in */
      const pencilButtons = editPencilButtons();
      const pencilB = pencilButtons[1]; /* index 1 = domain B (A is index 0) */
      expect(pencilB).toBeTruthy();
      fireEvent.click(pencilB);

      await waitFor(
        () => expect(document.querySelectorAll("input[placeholder='Domain name']").length).toBeGreaterThan(0),
        { timeout: 4_000 },
      );

      /* Error message must be absent in domain B's freshly-opened form */
      expect(screen.queryAllByText(/already exists/i).length).toBe(0);
      /* And we should be editing the correct domain — slug shown as read-only badge */
      const codeBadges = Array.from(document.querySelectorAll("code"));
      expect(codeBadges.some((c) => c.textContent === "beta")).toBe(true);
    },
  );
});
