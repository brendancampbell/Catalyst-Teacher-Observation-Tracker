// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/* ── Stub all heavy dependencies the page module transitively loads ─────────
 * AINarrativeRenderer is a pure render function and doesn't use any of these,
 * but importing action-center.tsx pulls them in at module scope.
 * ─────────────────────────────────────────────────────────────────────────── */
vi.mock("@/lib/api", () => ({
  fetchDashboard:           async () => null,
  fetchRubricSets:          async () => [],
  fetchRescoreQueue:        async () => [],
  fetchOverdueObservations: async () => [],
  fetchAIInsights:          async () => null,
  fetchAICalibrationFlags:  async () => [],
  fetchOverdueActionSteps:  async () => [],
  fetchDistrictSummary:     async () => null,
  fetchNetworkAverages:     async () => null,
  fetchChatSessions:        async () => [],
  createChatSession:        async () => ({ id: "s1", title: "Session", createdAt: "" }),
  fetchChatSessionMessages: async () => [],
  streamAIChat:             async () => ({}),
  generateAIAnalysis:       async () => null,
  renameChatSession:        async () => {},
  deleteChatSession:        async () => {},
  createObservation:        async () => ({}),
}));

vi.mock("@/components/AppHeader",           () => ({ default: () => null }));
vi.mock("@/components/NewObservationModal", () => ({ NewObservationModal: () => null }));

vi.mock("@/context/UserContext", () => ({
  useUser: () => ({
    currentUser:    { employeeId: "U10", name: "Test User", role: "NETWORK_ADMIN", schoolId: null },
    isLoading:      false,
    refetch:        async () => {},
    isImpersonating: false,
    realUser:       null,
  }),
  UserContext: {},
}));

vi.mock("wouter", () => ({
  useSearch:   () => "",
  useLocation: () => ["/action-center", vi.fn()],
  Link:        ({ children }: { children: React.ReactNode }) => children,
}));

class ResizeObserverStub {
  observe()    {}
  unobserve()  {}
  disconnect() {}
}
(globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;

/* ── Import the renderer under test ─────────────────────────────────────── */
import { AINarrativeRenderer } from "@/pages/action-center";

/* ═══════════════════════════════════════════════════════════════════════════
   TESTS
 ═══════════════════════════════════════════════════════════════════════════ */

describe("AINarrativeRenderer — plain paragraph", () => {
  it("renders plain text as a visible paragraph", () => {
    const { container } = render(<AINarrativeRenderer text="This is a plain paragraph." />);
    expect(container.textContent).toContain("This is a plain paragraph.");
  });

  it("renders bold text (**word**) as <strong>", () => {
    const { container } = render(<AINarrativeRenderer text="Here is **bold text** inline." />);
    const strong = container.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong!.textContent).toBe("bold text");
  });

  it("does not render raw ** asterisks in the DOM", () => {
    const { container } = render(<AINarrativeRenderer text="Here is **bold text** inline." />);
    expect(container.textContent).not.toContain("**");
  });
});

describe("AINarrativeRenderer — ## heading (Style A — Bebas Neue)", () => {
  it("renders ## heading content visibly (uppercased)", () => {
    const { container } = render(<AINarrativeRenderer text="## School Performance Overview" />);
    expect(container.textContent?.toUpperCase()).toContain("SCHOOL PERFORMANCE OVERVIEW");
  });

  it("does not render the ## prefix characters", () => {
    const { container } = render(<AINarrativeRenderer text="## School Performance Overview" />);
    expect(container.textContent).not.toContain("##");
  });

  it("uses Bebas Neue font for ## heading", () => {
    const { container } = render(<AINarrativeRenderer text="## My Section" />);
    const span = container.querySelector("span");
    expect(span?.style.fontFamily).toContain("Bebas Neue");
  });

  it("applies a yellow bottom border to ## heading", () => {
    const { container } = render(<AINarrativeRenderer text="## My Section" />);
    const span = container.querySelector("span");
    /* jsdom normalises #FFB500 → rgb(255, 181, 0) in border shorthands */
    expect(span?.style.borderBottom).toContain("rgb(255, 181, 0)");
  });
});

describe("AINarrativeRenderer — ### heading (Style B — Libre Franklin)", () => {
  it("renders ### heading content visibly", () => {
    const { container } = render(<AINarrativeRenderer text="### Teacher Highlights" />);
    expect(container.textContent).toContain("Teacher Highlights");
  });

  it("does not render the ### prefix characters", () => {
    const { container } = render(<AINarrativeRenderer text="### Teacher Highlights" />);
    expect(container.textContent).not.toContain("###");
  });

  it("uses Libre Franklin font for ### heading (not Bebas Neue)", () => {
    const { container } = render(<AINarrativeRenderer text="### Sub Section" />);
    const span = container.querySelector("span");
    expect(span?.style.fontFamily).toContain("Libre Franklin");
    expect(span?.style.fontFamily).not.toContain("Bebas Neue");
  });

  it("applies a yellow left border to the ### heading wrapper div", () => {
    const { container } = render(<AINarrativeRenderer text="### Sub Section" />);
    /* [0] = outer wrapper (fontFamily only), [1] = heading wrapper (has borderLeft) */
    const div = container.querySelectorAll("div")[1];
    /* jsdom normalises #FFB500 → rgb(255, 181, 0) in border shorthands */
    expect(div?.style.borderLeft).toContain("rgb(255, 181, 0)");
  });

  it("## heading is visually distinct from ### — different font families", () => {
    const h2 = render(<AINarrativeRenderer text="## Section A" />);
    const h3 = render(<AINarrativeRenderer text="### Section B" />);
    const h2Span = h2.container.querySelector("span");
    const h3Span = h3.container.querySelector("span");
    expect(h2Span?.style.fontFamily).not.toBe(h3Span?.style.fontFamily);
  });
});

describe("AINarrativeRenderer — bullet list", () => {
  it("renders - bullet text content visibly", () => {
    render(<AINarrativeRenderer text="- Alice Smith: avg 0.82" />);
    expect(screen.getByText(/Alice Smith/)).toBeTruthy();
  });

  it("renders * bullets as well as - bullets", () => {
    const { container } = render(<AINarrativeRenderer text={"* Item one\n* Item two"} />);
    expect(container.textContent).toContain("Item one");
    expect(container.textContent).toContain("Item two");
  });

  it("does not emit a leading '- ' dash in the text output", () => {
    const { container } = render(<AINarrativeRenderer text="- Alice Smith" />);
    expect(container.textContent).not.toMatch(/^-\s/);
  });

  it("renders multiple bullet items", () => {
    const text = "- Alice Smith\n- Bob Jones\n- Carol Lee";
    const { container } = render(<AINarrativeRenderer text={text} />);
    expect(container.textContent).toContain("Alice Smith");
    expect(container.textContent).toContain("Bob Jones");
    expect(container.textContent).toContain("Carol Lee");
  });
});

describe("AINarrativeRenderer — nested bullet list", () => {
  it("renders nested bullet text content visibly", () => {
    const { container } = render(<AINarrativeRenderer text={"- Top item\n  - Sub item"} />);
    expect(container.textContent).toContain("Sub item");
  });

  it("indents nested bullets with a left margin", () => {
    const { container } = render(<AINarrativeRenderer text={"- Top item\n  - Sub item"} />);
    const divs = Array.from(container.querySelectorAll("div")).filter(
      (d) => d.style.marginLeft === "16px",
    );
    expect(divs.length).toBeGreaterThan(0);
  });

  it("uses ◦ symbol for nested bullets instead of •", () => {
    const { container } = render(<AINarrativeRenderer text={"  - Sub item"} />);
    expect(container.textContent).toContain("◦");
    expect(container.textContent).not.toContain("•");
  });

  it("top-level bullets still use • symbol", () => {
    const { container } = render(<AINarrativeRenderer text={"- Top item"} />);
    expect(container.textContent).toContain("•");
    expect(container.textContent).not.toContain("◦");
  });

  it("top-level bullets have no left margin", () => {
    const { container } = render(<AINarrativeRenderer text={"- Top item"} />);
    const bulletDiv = Array.from(container.querySelectorAll("div")).find(
      (d) => d.style.display === "flex",
    );
    expect(bulletDiv?.style.marginLeft ?? "").not.toBe("16px");
  });
});

describe("AINarrativeRenderer — deeply nested bullet list (level 3)", () => {
  it("renders deeply nested bullet text content visibly", () => {
    const { container } = render(<AINarrativeRenderer text={"    - Deep item"} />);
    expect(container.textContent).toContain("Deep item");
  });

  it("indents deeply nested bullets with 32px left margin", () => {
    const { container } = render(<AINarrativeRenderer text={"    - Deep item"} />);
    const divs = Array.from(container.querySelectorAll("div")).filter(
      (d) => d.style.marginLeft === "32px",
    );
    expect(divs.length).toBeGreaterThan(0);
  });

  it("uses ▪ symbol for deeply nested bullets", () => {
    const { container } = render(<AINarrativeRenderer text={"    - Deep item"} />);
    expect(container.textContent).toContain("▪");
    expect(container.textContent).not.toContain("◦");
    expect(container.textContent).not.toContain("•");
  });

  it("level-1 nested bullet (2 spaces) still uses ◦ and 16px margin", () => {
    const { container } = render(<AINarrativeRenderer text={"  - Level two item"} />);
    expect(container.textContent).toContain("◦");
    const divs = Array.from(container.querySelectorAll("div")).filter(
      (d) => d.style.marginLeft === "16px",
    );
    expect(divs.length).toBeGreaterThan(0);
  });

  it("all three bullet levels render correctly in one block", () => {
    const text = "- Top item\n  - Sub item\n    - Deep item";
    const { container } = render(<AINarrativeRenderer text={text} />);
    expect(container.textContent).toContain("Top item");
    expect(container.textContent).toContain("Sub item");
    expect(container.textContent).toContain("Deep item");
    expect(container.textContent).toContain("•");
    expect(container.textContent).toContain("◦");
    expect(container.textContent).toContain("▪");
  });
});

describe("AINarrativeRenderer — deeply nested numbered list (level 3)", () => {
  it("renders deeply nested numbered item text visibly", () => {
    const { container } = render(<AINarrativeRenderer text={"    1. Deep step"} />);
    expect(container.textContent).toContain("Deep step");
  });

  it("indents deeply nested numbered items with 32px left margin", () => {
    const { container } = render(<AINarrativeRenderer text={"    1. Deep step"} />);
    const divs = Array.from(container.querySelectorAll("div")).filter(
      (d) => d.style.marginLeft === "32px",
    );
    expect(divs.length).toBeGreaterThan(0);
  });

  it("level-1 nested numbered item (2 spaces) still uses 16px margin", () => {
    const { container } = render(<AINarrativeRenderer text={"  1. Sub step"} />);
    const divs = Array.from(container.querySelectorAll("div")).filter(
      (d) => d.style.marginLeft === "16px",
    );
    expect(divs.length).toBeGreaterThan(0);
  });
});

describe("AINarrativeRenderer — nested numbered list", () => {
  it("renders nested numbered item text visibly", () => {
    const { container } = render(<AINarrativeRenderer text={"1. Top step\n  1. Sub step"} />);
    expect(container.textContent).toContain("Sub step");
  });

  it("indents nested numbered items with a left margin", () => {
    const { container } = render(<AINarrativeRenderer text={"  1. Sub step"} />);
    const divs = Array.from(container.querySelectorAll("div")).filter(
      (d) => d.style.marginLeft === "16px",
    );
    expect(divs.length).toBeGreaterThan(0);
  });

  it("top-level numbered items have no left margin", () => {
    const { container } = render(<AINarrativeRenderer text={"1. Top step"} />);
    const numberedDiv = Array.from(container.querySelectorAll("div")).find(
      (d) => d.style.display === "flex",
    );
    expect(numberedDiv?.style.marginLeft ?? "").not.toBe("16px");
  });
});

describe("AINarrativeRenderer — numbered list", () => {
  it("renders numbered item text visibly", () => {
    const { container } = render(<AINarrativeRenderer text="1. First priority: schedule calibration" />);
    expect(container.textContent).toContain("First priority");
  });

  it("preserves the number label in the DOM", () => {
    const { container } = render(<AINarrativeRenderer text="1. First item" />);
    expect(container.textContent).toContain("1.");
  });

  it("renders multiple numbered items", () => {
    const text = "1. First step\n2. Second step\n3. Third step";
    const { container } = render(<AINarrativeRenderer text={text} />);
    expect(container.textContent).toContain("First step");
    expect(container.textContent).toContain("Second step");
    expect(container.textContent).toContain("Third step");
  });
});

describe("AINarrativeRenderer — Note: callout box", () => {
  it("renders Note: content visibly", () => {
    const { container } = render(<AINarrativeRenderer text="Note: Two teachers are flagged for review." />);
    expect(container.textContent).toContain("Two teachers are flagged");
  });

  it("applies amber background to Note: callout", () => {
    const { container } = render(<AINarrativeRenderer text="Note: Important callout here." />);
    /* querySelectorAll("div")[0] = outer wrapper; [1] = callout div */
    const callout = container.querySelectorAll("div")[1];
    /* jsdom normalises #FEF3C7 → rgb(254, 243, 199) */
    expect(callout?.style.backgroundColor).toBe("rgb(254, 243, 199)");
  });

  it("applies a yellow left border to Note: callout", () => {
    const { container } = render(<AINarrativeRenderer text="Note: Important callout here." />);
    const callout = container.querySelectorAll("div")[1];
    /* jsdom normalises #FFB500 → rgb(255, 181, 0) in border shorthands */
    expect(callout?.style.borderLeft).toContain("rgb(255, 181, 0)");
  });

  it("renders ⚠ warning lines with the same callout style", () => {
    const { container } = render(<AINarrativeRenderer text="⚠ Calibration flag detected." />);
    const callout = container.querySelectorAll("div")[1];
    expect(callout?.style.backgroundColor).toBe("rgb(254, 243, 199)");
    expect(container.textContent).toContain("Calibration flag detected");
  });
});

describe("AINarrativeRenderer — markdown table", () => {
  const TABLE_TEXT = [
    "| Teacher | Domain | Score |",
    "|---------|--------|-------|",
    "| Alice Smith | Classroom Culture | 0.82 |",
    "| Bob Jones | Instruction | 0.79 |",
  ].join("\n");

  it("renders a <table> element", () => {
    const { container } = render(<AINarrativeRenderer text={TABLE_TEXT} />);
    expect(container.querySelector("table")).not.toBeNull();
  });

  it("renders column headers in <th> cells", () => {
    const { container } = render(<AINarrativeRenderer text={TABLE_TEXT} />);
    const headers = Array.from(container.querySelectorAll("th")).map((th) => th.textContent);
    expect(headers).toContain("Teacher");
    expect(headers).toContain("Domain");
    expect(headers).toContain("Score");
  });

  it("renders data rows in <td> cells", () => {
    const { container } = render(<AINarrativeRenderer text={TABLE_TEXT} />);
    const cells = Array.from(container.querySelectorAll("td")).map((td) => td.textContent);
    expect(cells.some((c) => c?.includes("Alice Smith"))).toBe(true);
    expect(cells.some((c) => c?.includes("Bob Jones"))).toBe(true);
  });

  it("does not show raw pipe characters inside table cells", () => {
    const { container } = render(<AINarrativeRenderer text={TABLE_TEXT} />);
    const cells = Array.from(container.querySelectorAll("td, th")).map((el) => el.textContent ?? "");
    for (const cell of cells) {
      expect(cell).not.toContain("|");
    }
  });

  it("applies navy background to table header row", () => {
    const { container } = render(<AINarrativeRenderer text={TABLE_TEXT} />);
    const th = container.querySelector("th");
    /* jsdom normalises #1034B4 → rgb(16, 52, 180) */
    expect(th?.style.backgroundColor).toBe("rgb(16, 52, 180)");
  });
});

describe("AINarrativeRenderer — mixed rich content (full regression)", () => {
  const FULL_RESPONSE = `## School Performance Overview

This is a **plain paragraph** with some bold text and normal prose.

### Teacher Highlights

The following teachers are performing above threshold:

- Alice Smith: avg 0.82 across 12 observations
- Bob Jones: avg 0.79 across 8 observations

1. First priority: schedule calibration for Domain 2
2. Second priority: review walkthrough data with coaches

Note: Two teachers are flagged for calibration review this week.

| Teacher | Domain | Score |
|---------|--------|-------|
| Alice Smith | Classroom Culture | 0.82 |
| Bob Jones | Instruction | 0.79 |`;

  it("renders a full mixed-format response without throwing", () => {
    expect(() => render(<AINarrativeRenderer text={FULL_RESPONSE} />)).not.toThrow();
  });

  it("renders all named elements from a full response", () => {
    const { container } = render(<AINarrativeRenderer text={FULL_RESPONSE} />);
    const text = container.textContent ?? "";
    expect(text.toUpperCase()).toContain("SCHOOL PERFORMANCE OVERVIEW");
    expect(text).toContain("Teacher Highlights");
    expect(text).toContain("plain paragraph");
    expect(text).toContain("Alice Smith");
    expect(text).toContain("First priority");
    expect(text).toContain("Two teachers are flagged");
  });

  it("renders a table for the pipe-delimited section", () => {
    const { container } = render(<AINarrativeRenderer text={FULL_RESPONSE} />);
    expect(container.querySelector("table")).not.toBeNull();
  });

  it("contains no raw ## or ** markdown syntax in the output text", () => {
    const { container } = render(<AINarrativeRenderer text={FULL_RESPONSE} />);
    const text = container.textContent ?? "";
    expect(text).not.toContain("##");
    expect(text).not.toContain("**");
  });
});
