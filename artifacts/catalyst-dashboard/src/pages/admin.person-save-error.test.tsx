// @vitest-environment jsdom
/**
 * A refused Add or Edit on the Users tab is said in the page's own error box.
 *
 * Both used to hand the server's message to the browser's alert(), which
 * covers the form it is about. The message now names who already holds the
 * email or employee ID, so it has to sit beside the fields while the admin
 * decides what to change — and the form has to keep what they typed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, waitFor, fireEvent, act, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/* ── Hoisted mocks ────────────────────────────────────────────────────────── */
const { mockCreatePerson, mockUpdatePerson } = vi.hoisted(() => ({
  mockCreatePerson: vi.fn(),
  mockUpdatePerson: vi.fn(),
}));

const PERSON = {
  employeeId: "E1", firstName: "Jane", lastName: "Doe", name: "Jane Doe",
  email: "jane@example.com", role: "NO_ACCESS", schoolId: 1, schoolName: "Lincoln",
  isActive: true, includeInFeedbackTracker: true, department: null, gradeLevel: [],
  needsRescore: false, rescoreDueDate: null, schoolOrphaned: false,
};

const SCHOOL = {
  id: 1, displayName: "Lincoln", fullName: "Lincoln Middle", abbreviation: "LIN",
  region: "Newark", gradeSpan: "MS", isActive: true, isArchived: false,
  isHomeOffice: false, schoolNumber: null,
};

/* ── Stub @/lib/api ───────────────────────────────────────────────────────── */
vi.mock("@/lib/api", () => ({
  fetchRubric:        async () => ({ rubricSet: null, categories: [] }),
  updateDomain:       async () => ({}),
  createCategory:     async () => ({}),
  updateCategory:     async () => ({}),
  deleteCategory:     async () => ({}),
  reorderCategories:  async () => ({}),
  createDomain:       async () => ({}),
  deleteDomain:       async () => ({}),
  reorderDomains:     async () => ({}),
  fetchRubricSets:    async () => [],
  fetchPeople:        async () => [PERSON],
  createPerson:       mockCreatePerson,
  updatePerson:       mockUpdatePerson,
  togglePersonActive: async () => ({}),
  startImpersonation: async () => ({}),
  bulkImportPeople:   async () => ({}),
  fetchAdminSchools:  async () => [SCHOOL],
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

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }

const ADD_MESSAGE  = "The email jane@example.com already belongs to Jane Doe, who is deactivated at Lincoln.";
const EDIT_MESSAGE = "The email taken@example.com already belongs to someone at Roosevelt. Contact Catalyst support.";

async function renderUsersTab() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  const AdminPage = (await import("@/pages/admin")).default;
  render(
    <QueryClientProvider client={qc}>
      <AdminPage />
    </QueryClientProvider>,
  );
}

/** The row's Edit pencil, once schools have loaded and it is enabled. */
async function enabledEditPencil() {
  return waitFor(() => {
    const btn = Array.from(document.querySelectorAll("button"))
      .find((b) => b.className.includes("hover:text-blue-600") && !b.disabled);
    if (!btn) throw new Error("edit pencil not ready");
    return btn;
  }, { timeout: 8_000 });
}

function alertsSaying(text: string) {
  return screen.queryAllByRole("alert").filter((a) => a.textContent?.includes(text));
}

let alertSpy: ReturnType<typeof vi.spyOn>;

describe("Users tab — a refused save is shown in the page, not a browser alert", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
    window.history.replaceState(null, "", "/admin?tab=people");
    alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    mockCreatePerson.mockRejectedValue(new Error(ADD_MESSAGE));
    mockUpdatePerson.mockRejectedValue(new Error(EDIT_MESSAGE));
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/admin");
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("Add Person: the message appears in the form, which keeps what was typed", { timeout: 20_000 }, async () => {
    await renderUsersTab();
    await enabledEditPencil();

    fireEvent.click(screen.getByRole("button", { name: /Add Person/ }));
    const form = screen.getByText("Add New Person").parentElement!;

    fireEvent.change(within(form).getByPlaceholderText("First name *"),  { target: { value: "Jane" } });
    fireEvent.change(within(form).getByPlaceholderText("Last name *"),   { target: { value: "Doe" } });
    fireEvent.change(within(form).getByPlaceholderText("Employee ID *"), { target: { value: "E9" } });
    fireEvent.change(within(form).getByPlaceholderText("Email *"),       { target: { value: "jane@example.com" } });

    await act(async () => {
      fireEvent.click(within(form).getByRole("button", { name: "Add Person" }));
    });

    await waitFor(() => expect(alertsSaying(ADD_MESSAGE)).toHaveLength(1), { timeout: 4_000 });
    expect(form.contains(alertsSaying(ADD_MESSAGE)[0]!)).toBe(true);
    expect(alertSpy).not.toHaveBeenCalled();
    expect((within(form).getByPlaceholderText("Email *") as HTMLInputElement).value).toBe("jane@example.com");

    /* Cancel and reopen: the old message must not greet the next attempt. */
    fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: /Add Person/ }));
    expect(alertsSaying(ADD_MESSAGE)).toHaveLength(0);
  });

  it("Edit: the message appears in the edit row, and is gone after Cancel", { timeout: 20_000 }, async () => {
    await renderUsersTab();
    fireEvent.click(await enabledEditPencil());

    const email = await waitFor(() => screen.getByPlaceholderText("Email") as HTMLInputElement, { timeout: 4_000 });
    fireEvent.change(email, { target: { value: "taken@example.com" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    await waitFor(() => expect(alertsSaying(EDIT_MESSAGE)).toHaveLength(1), { timeout: 4_000 });
    expect(alertSpy).not.toHaveBeenCalled();
    expect((screen.getByPlaceholderText("Email") as HTMLInputElement).value).toBe("taken@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(await enabledEditPencil());
    await waitFor(() => screen.getByPlaceholderText("Email"), { timeout: 4_000 });
    expect(alertsSaying(EDIT_MESSAGE)).toHaveLength(0);
  });
});
