// @vitest-environment jsdom
/**
 * The usage table paginates client-side: the API hands back every person at
 * once, and the table shows a window of them.
 *
 * Failure modes guarded here:
 *   - rendering every row regardless of page (pagination that looks right but
 *     does nothing);
 *   - narrowing a filter while on a later page and landing on an empty table,
 *     because the page index survived the change to the row set.
 */

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { UsageReport, UsageRow } from "@workspace/api-types";

const { mockFetchUsage } = vi.hoisted(() => ({ mockFetchUsage: vi.fn() }));

vi.mock("@/lib/api", () => ({
  fetchUsage: (...a: unknown[]) => mockFetchUsage(...a),
}));

import { UsageTable } from "./UsageTable";

/* 30 people, all in one school so the School column stays hidden, and
   descending "days used" puts Person 01 first — the default sort. */
function makeRows(n: number): UsageRow[] {
  return Array.from({ length: n }, (_, i) => ({
    employeeId:   `emp-${i + 1}`,
    name:         `Person ${String(i + 1).padStart(2, "0")}`,
    role:         i === 0 ? "COACH" : "NO_ACCESS",
    schoolId:     1,
    schoolName:   "Test Academy",
    lastUsed:     "2026-05-01",
    daysUsed:     n - i,
    observations: 0,
    actionSteps:  0,
  }));
}

function renderTable() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <UsageTable schoolId={1} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  const report: UsageReport = {
    schoolYear:     "2025-2026",
    recordingSince: "2025-08-01",
    rows:           makeRows(30),
  };
  mockFetchUsage.mockResolvedValue(report);
});

describe("UsageTable pagination", () => {
  it("shows only the first page, not every row", async () => {
    renderTable();

    await screen.findByText("Person 01");
    /* 30 people, 25 per page: the 26th is on page two. */
    expect(screen.getByText("Person 25")).toBeTruthy();
    expect(screen.queryByText("Person 26")).toBeNull();
    expect(screen.getByText("Showing 1–25 of 30 people")).toBeTruthy();
  });

  it("moves to the next page", async () => {
    renderTable();
    await screen.findByText("Person 01");

    fireEvent.click(screen.getByLabelText("Next page"));

    await waitFor(() => expect(screen.getByText("Person 26")).toBeTruthy());
    expect(screen.queryByText("Person 01")).toBeNull();
    expect(screen.getByText("Showing 26–30 of 30 people")).toBeTruthy();
  });

  it("returns to page one when a filter narrows the rows underneath it", async () => {
    renderTable();
    await screen.findByText("Person 01");

    fireEvent.click(screen.getByLabelText("Next page"));
    await waitFor(() => expect(screen.getByText("Person 26")).toBeTruthy());

    /* One COACH, and they are on page one. Without the reset the table would
       still be on page two and show nothing. */
    fireEvent.change(screen.getByLabelText("Filter by role"), { target: { value: "COACH" } });

    await waitFor(() => expect(screen.getByText("Person 01")).toBeTruthy());
    expect(screen.getByText("Showing 1–1 of 1 person")).toBeTruthy();
  });

  it("honours the per-page picker", async () => {
    renderTable();
    await screen.findByText("Person 01");

    fireEvent.change(screen.getByLabelText("Rows per page"), { target: { value: "10" } });

    await waitFor(() => expect(screen.queryByText("Person 11")).toBeNull());
    expect(screen.getByText("Person 10")).toBeTruthy();
    expect(screen.getByText("Showing 1–10 of 30 people")).toBeTruthy();
  });
});
