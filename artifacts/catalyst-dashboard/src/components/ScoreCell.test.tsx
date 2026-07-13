// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScoreCell } from "./ScoreCell";

/* ── ScoreCell component rendering ───────────────────────────────────────────
 * These tests render the real ScoreCell production component in a jsdom
 * environment and assert the actual DOM text content.  ScoreCell is the
 * primitive rendered inside every score column in Dashboard.tsx and every
 * domain cell in DistrictDashboard.tsx.
 * ─────────────────────────────────────────────────────────────────────────── */

function renderCell(score: number | null) {
  render(
    <table>
      <tbody>
        <tr>
          <ScoreCell score={score} />
        </tr>
      </tbody>
    </table>,
  );
  return screen.getByRole("cell");
}

describe("ScoreCell DOM output — null score", () => {
  it("renders the em-dash sentinel for a null score", () => {
    const cell = renderCell(null);
    expect(cell.textContent).toBe("—");
  });
});

describe("ScoreCell DOM output — 0.0 score", () => {
  it("renders '0.0' in the DOM for score=0, not '—'", () => {
    const cell = renderCell(0);
    expect(cell.textContent).toBe("0.0");
  });

  it("does NOT render '—' for score=0 — falsy guard regression check", () => {
    const cell = renderCell(0);
    expect(cell.textContent).not.toBe("—");
  });

  it("renders '0.0' for score=0.0 (explicit float form)", () => {
    const cell = renderCell(0.0);
    expect(cell.textContent).toBe("0.0");
  });
});

describe("ScoreCell DOM output — other values", () => {
  it("renders '1.0' for score=1", () => {
    const cell = renderCell(1);
    expect(cell.textContent).toBe("1.0");
  });

  it("renders '0.5' for score=0.5", () => {
    const cell = renderCell(0.5);
    expect(cell.textContent).toBe("0.5");
  });

  it("rounds 0.75 to '0.8'", () => {
    const cell = renderCell(0.75);
    expect(cell.textContent).toBe("0.8");
  });
});
