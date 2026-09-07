// @vitest-environment jsdom
/**
 * The observation history is a table now, not a stack of cards, and it pages
 * client-side: the dashboard already holds every observation, so the table
 * shows a window of them.
 *
 * Failure modes guarded here:
 *   - rendering every row regardless of page (pagination that looks right but
 *     does nothing);
 *   - showing page controls for a history that fits on one page;
 *   - averaging a partial observation over the whole rubric, which would count
 *     the domains it never opened as zeroes and make every walkthrough look
 *     like a disaster.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { CategoryEntry, Observation } from "@workspace/api-types";
import { ObservationHistoryTable, observationAverage } from "./ObservationHistoryTable";

const categories = [
  { id: "c1", label: "Instruction", domains: [
    { id: "d1", label: "Planning" },
    { id: "d2", label: "Pacing" },
  ] },
] as CategoryEntry[];

/* Dated backwards from September so row order is unambiguous. */
function makeObs(n: number): Observation[] {
  return Array.from({ length: n }, (_, i) =>
    ({
      id:       `obs-${i + 1}`,
      date:     `2026-09-${String(n - i).padStart(2, "0")}`,
      scores:   { d1: 1, d2: 1 },
      observer: `Observer ${i + 1}`,
    }) as unknown as Observation,
  );
}

function renderTable(observations: Observation[], onSelect = vi.fn()) {
  render(
    <ObservationHistoryTable
      observations={observations}
      categories={categories}
      onSelect={onSelect}
    />,
  );
  return onSelect;
}

describe("observation history table", () => {
  it("shows only the first ten rows, not every observation", () => {
    renderTable(makeObs(14));
    expect(screen.getByText("Observer 1")).toBeTruthy();
    expect(screen.getByText("Observer 10")).toBeTruthy();
    /* The 11th is on page two. */
    expect(screen.queryByText("Observer 11")).toBeNull();
  });

  it("moves to the next page", () => {
    renderTable(makeObs(14));
    fireEvent.click(screen.getByLabelText("Next page"));
    expect(screen.getByText("Observer 11")).toBeTruthy();
    expect(screen.queryByText("Observer 1")).toBeNull();
  });

  /* Page controls under a four-row history are noise, and the whole point of
     the table is to take vertical space back. */
  it("hides the page controls when everything fits on one page", () => {
    renderTable(makeObs(10));
    expect(screen.queryByLabelText("Next page")).toBeNull();
    expect(screen.getByText("Observer 10")).toBeTruthy();
  });

  it("opens the observation behind a clicked row", () => {
    const onSelect = renderTable(makeObs(3));
    fireEvent.click(screen.getByLabelText("View observation from 2026-09-03"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]![0].id).toBe("obs-1");
  });

  it("tells a walkthrough apart from a full observation", () => {
    const [full, walk] = [
      { id: "a", date: "2026-09-02", scores: { d1: 1 }, observer: "A" },
      { id: "b", date: "2026-09-01", scores: { d1: 1 }, observer: "B", isWalkthrough: true },
    ] as unknown as Observation[];
    renderTable([full!, walk!]);
    expect(screen.getByText("Walkthrough")).toBeTruthy();
    expect(screen.getByText("Full Observation")).toBeTruthy();
  });

  it("says so plainly when there is no history at all", () => {
    renderTable([]);
    expect(screen.getByText(/no observations recorded yet/i)).toBeTruthy();
  });
});

describe("a single observation's average", () => {
  it("averages the domains that were scored", () => {
    const obs = { id: "a", date: "2026-09-01", scores: { d1: 1, d2: 0 }, observer: "A" } as unknown as Observation;
    expect(observationAverage(obs, categories)).toBe(0.5);
  });

  /* The case that matters: a walkthrough covering one domain of two is a 1.0
     on what it looked at, not a 0.5 overall. Averaging over the full rubric
     would silently punish every short visit. */
  it("ignores domains the observation never opened", () => {
    const obs = { id: "a", date: "2026-09-01", scores: { d1: 1 }, observer: "A" } as unknown as Observation;
    expect(observationAverage(obs, categories)).toBe(1);
  });

  it("returns nothing for an observation that scored no domain", () => {
    const obs = { id: "a", date: "2026-09-01", scores: {}, observer: "A" } as unknown as Observation;
    expect(observationAverage(obs, categories)).toBeNull();
  });
});
