/**
 * AppProvider — stale selectedRubric validation tests
 *
 * Verifies that AppProvider clears a persisted rubric whose id is absent
 * from the current school-year's `/api/rubric/sets` response, mirroring
 * the selectedSchool guard already in place.
 *
 * On load AppProvider fetches rubric/sets (enabled whenever selectedRubric
 * is non-null), then runs a useEffect: if the persisted id is not in the
 * returned list it calls setSelectedRubric(null) and removes RUBRIC_LS_KEY
 * from localStorage. Any child page that requires a valid rubric will then
 * redirect to /rubric-picker.
 */

import React, { useEffect } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppProvider, useApp } from "@/context/AppContext";

// ── Constants (must match AppContext.tsx) ──────────────────────────────────

const RUBRIC_LS_KEY = "catalyst-mobile-selected-rubric";

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();

vi.mock("wouter", () => ({
  useLocation: () => ["/observation", mockNavigate],
  useSearch: () => "",
}));

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: 1,
      role: "SCHOOL_LEADER" as const,
      schoolId: 1,
      schoolName: "Test School",
    },
    isLoading: false,
  }),
}));

vi.mock("@/lib/roles", () => ({
  isNetworkScope: () => false,
}));

const mockApiFetch = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    apiFetch: (...args: unknown[]) => mockApiFetch(...args),
  };
});

// ── Minimal consumer ───────────────────────────────────────────────────────

/**
 * Reads selectedRubric from context and navigates to /rubric-picker when
 * it is null — the same guard any observation page would apply.
 */
function MinimalConsumer() {
  const { selectedRubric } = useApp();

  useEffect(() => {
    if (selectedRubric === null) {
      mockNavigate("/rubric-picker");
    }
  }, [selectedRubric]);

  return (
    <div data-testid="rubric-state">
      {selectedRubric ? `rubric:${selectedRubric.id}` : "no-rubric"}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function renderWithProvider() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AppProvider>
        <MinimalConsumer />
      </AppProvider>
    </QueryClientProvider>,
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("AppProvider — stale selectedRubric validation", () => {
  beforeEach(() => {
    localStorage.clear();
    mockNavigate.mockClear();
    vi.clearAllMocks();

    mockApiFetch.mockImplementation((url: string) => {
      if (url.includes("/api/rubric/sets")) {
        return Promise.resolve([{ id: 7, slug: "default", name: "Current Rubric", isArchived: false }]);
      }
      return Promise.resolve([]);
    });
  });

  it("clears selectedRubric from state when persisted id is absent from rubric-sets list", async () => {
    localStorage.setItem(
      RUBRIC_LS_KEY,
      JSON.stringify({ id: 999, slug: "old-rubric", name: "Stale Rubric" }),
    );

    renderWithProvider();

    await waitFor(
      () => expect(screen.getByTestId("rubric-state").textContent).toBe("no-rubric"),
      { timeout: 4000 },
    );
  });

  it("removes RUBRIC_LS_KEY from localStorage when persisted rubric is stale", async () => {
    localStorage.setItem(
      RUBRIC_LS_KEY,
      JSON.stringify({ id: 999, slug: "old-rubric", name: "Stale Rubric" }),
    );

    renderWithProvider();

    await waitFor(
      () => expect(localStorage.getItem(RUBRIC_LS_KEY)).toBeNull(),
      { timeout: 4000 },
    );
  });

  it("navigates to /rubric-picker after stale rubric is cleared", async () => {
    localStorage.setItem(
      RUBRIC_LS_KEY,
      JSON.stringify({ id: 999, slug: "old-rubric", name: "Stale Rubric" }),
    );

    renderWithProvider();

    await waitFor(
      () => expect(mockNavigate).toHaveBeenCalledWith("/rubric-picker"),
      { timeout: 4000 },
    );
  });

  it("does NOT clear selectedRubric when persisted id is present in the rubric-sets list", async () => {
    localStorage.setItem(
      RUBRIC_LS_KEY,
      JSON.stringify({ id: 7, slug: "default", name: "Current Rubric" }),
    );

    renderWithProvider();

    await waitFor(
      () => expect(screen.getByTestId("rubric-state").textContent).toBe("rubric:7"),
      { timeout: 4000 },
    );

    expect(localStorage.getItem(RUBRIC_LS_KEY)).not.toBeNull();
    expect(mockNavigate).not.toHaveBeenCalledWith("/rubric-picker");
  });

  it("does not fetch rubric/sets when selectedRubric is null on load", async () => {
    renderWithProvider();

    await waitFor(
      () => expect(screen.getByTestId("rubric-state").textContent).toBe("no-rubric"),
      { timeout: 2000 },
    );

    const rubricSetCalls = mockApiFetch.mock.calls.filter(([url]: [string]) =>
      url.includes("/api/rubric/sets"),
    );
    expect(rubricSetCalls).toHaveLength(0);
  });
});
