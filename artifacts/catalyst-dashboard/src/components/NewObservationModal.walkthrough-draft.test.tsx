// @vitest-environment jsdom
/**
 * NewObservationModal — Walkthrough toggle draft save-and-resume cycle
 *
 * Covers:
 *   1. Autosave correctly sends isWalkthrough=true when the toggle is on.
 *   2. Autosave correctly sends isWalkthrough=false when the toggle is left off.
 *   3. Resuming a draft via resumeDraftId restores isWalkthrough=true.
 *   4. Resuming a draft via resumeDraftId restores isWalkthrough=false (default preserved).
 */

import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

/* ── Radix Dialog: render inline (no portal) so jsdom can find content ── */
vi.mock("@radix-ui/react-dialog", () => {
  return {
    Root: ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
      open ? React.createElement(React.Fragment, null, children) : null,
    Portal: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    Overlay: () => null,
    Content: ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", { "data-testid": "modal-content" }, children),
    Title: ({ children }: { children: React.ReactNode }) =>
      React.createElement("h2", null, children),
    Close: ({ children, className }: { children: React.ReactNode; className?: string }) =>
      React.createElement("button", { className }, children),
  };
});

/* ── RichTextEditor: simple textarea so onChange is exercisable ── */
vi.mock("@/components/RichTextEditor", () => ({
  RichTextEditor: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
  }) =>
    React.createElement("textarea", {
      "data-testid": "rich-editor",
      placeholder,
      value,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value),
    }),
}));

/* ── Lucide icons: lightweight stubs ── */
vi.mock("lucide-react", () => ({
  X:          () => null,
  Plus:       () => null,
  Loader2:    () => null,
  RotateCcw:  () => null,
  AlertCircle:() => null,
  RefreshCw:  () => null,
}));

/* ── Toast hook: no-op ── */
vi.mock("@/hooks/use-toast", () => ({
  toast: () => {},
  useToast: () => ({ toast: () => {} }),
}));

/* ── subject-audience: always passes ── */
vi.mock("@/lib/subject-audience", () => ({
  teacherMatchesAudience: () => true,
}));

/* ── API mocks ── */
const mockCreateObservation     = vi.fn();
const mockUpdateObservation     = vi.fn();
const mockFetchMyDrafts         = vi.fn();
const mockFetchLatestActionStep = vi.fn();

vi.mock("@/lib/api", () => ({
  createObservation:     (...args: unknown[]) => mockCreateObservation(...args),
  updateObservation:     (...args: unknown[]) => mockUpdateObservation(...args),
  fetchMyDrafts:         (...args: unknown[]) => mockFetchMyDrafts(...args),
  fetchLatestActionStep: (...args: unknown[]) => mockFetchLatestActionStep(...args),
  sendObservationEmail:  vi.fn(),
}));

/* ── Fixtures ── */
const TEACHERS = [
  {
    id:          "teacher-1",
    employeeId:  "emp-001",
    name:        "Alice Smith",
    firstName:   "Alice",
    lastName:    "Smith",
    subject:     "Math",
    gradeLevel:  ["9"],
    observations: [],
    email:       "alice@school.edu",
  },
];

const CATEGORIES = [
  {
    id:      "cat-1",
    label:   "Instruction",
    domains: [{ id: "domain-1", label: "Planning" }],
  },
];

const ALL_DOMAINS = [{ id: "domain-1", label: "Planning" }];

const STUB_DRAFT_BASE = {
  id:                 "draft-abc",
  observedEmployeeId: "teacher-1",
  rubricSetId:        7,
  date:               "2026-07-15",
  time:               "09:30",
  course:             "Algebra I",
  scores:             { "domain-1": 1 },
  strengths:          "<p>Great lesson</p>",
  growthAreas:        "<p>Pacing</p>",
  status:             "draft" as const,
};

/* ── Default props factory ── */
function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    teachers:     TEACHERS as never,
    categories:   CATEGORIES,
    allDomains:   ALL_DOMAINS,
    open:         true,
    onOpenChange: vi.fn(),
    onSubmit:     vi.fn().mockResolvedValue("obs-new"),
    rubricSetId:  7,
    freshStart:   true,
    ...overrides,
  };
}

/* ================================================================== */
/* Group 1: autosave payload correctness (uses fake timers)           */
/* ================================================================== */
describe("NewObservationModal — autosave captures isWalkthrough correctly", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockCreateObservation.mockResolvedValue({ id: "draft-abc" });
    mockUpdateObservation.mockResolvedValue({ id: "draft-abc" });
    mockFetchMyDrafts.mockResolvedValue([]);
    mockFetchLatestActionStep.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("sends isWalkthrough=true when the toggle is on", async () => {
    const { NewObservationModal } = await import("@/components/NewObservationModal");

    render(React.createElement(NewObservationModal, makeProps()));

    /*
     * Score buttons render with their numeric label: "0", "0.5", "1".
     * The title attribute carries the descriptive label ("Proficient").
     * Click "1" (Proficient) so hasContent becomes true.
     */
    const profButton = screen.getByTitle("Proficient");
    fireEvent.click(profButton);

    /* Toggle walkthrough on — use accessible name to disambiguate from emailFeedback switch */
    const toggle = screen.getByRole("switch", { name: /walkthrough/i });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    /* Fire the 2-second autosave debounce */
    await act(async () => {
      vi.advanceTimersByTime(2500);
      await Promise.resolve();
    });

    expect(mockCreateObservation).toHaveBeenCalledOnce();
    const payload = mockCreateObservation.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.isWalkthrough).toBe(true);
  });

  it("sends isWalkthrough=false when the toggle is left off", async () => {
    const { NewObservationModal } = await import("@/components/NewObservationModal");

    render(React.createElement(NewObservationModal, makeProps()));

    /* Add content without touching the walkthrough toggle */
    const profButton = screen.getByTitle("Proficient");
    fireEvent.click(profButton);

    await act(async () => {
      vi.advanceTimersByTime(2500);
      await Promise.resolve();
    });

    expect(mockCreateObservation).toHaveBeenCalledOnce();
    const payload = mockCreateObservation.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.isWalkthrough).toBe(false);
  });
});

/* ================================================================== */
/* Group 2: draft restore restores isWalkthrough (real timers)        */
/* ================================================================== */
describe("NewObservationModal — draft restore preserves isWalkthrough", () => {
  beforeEach(() => {
    mockCreateObservation.mockResolvedValue({ id: "draft-abc" });
    mockUpdateObservation.mockResolvedValue({ id: "draft-abc" });
    mockFetchLatestActionStep.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("restores isWalkthrough=true from a saved draft", async () => {
    mockFetchMyDrafts.mockResolvedValue([
      { ...STUB_DRAFT_BASE, isWalkthrough: true },
    ]);

    const { NewObservationModal } = await import("@/components/NewObservationModal");

    render(
      React.createElement(NewObservationModal, makeProps({
        freshStart:    false,
        resumeDraftId: "draft-abc",
      })),
    );

    /* Let the loadDraftById async call settle */
    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(() => {
      const t = screen.getByRole("switch", { name: /walkthrough/i });
      expect(t.getAttribute("aria-checked")).toBe("true");
    }, { timeout: 2000 });
  });

  it("preserves isWalkthrough=false (default) from a saved draft", async () => {
    mockFetchMyDrafts.mockResolvedValue([
      { ...STUB_DRAFT_BASE, isWalkthrough: false },
    ]);

    const { NewObservationModal } = await import("@/components/NewObservationModal");

    render(
      React.createElement(NewObservationModal, makeProps({
        freshStart:    false,
        resumeDraftId: "draft-abc",
      })),
    );

    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(() => {
      const t = screen.getByRole("switch", { name: /walkthrough/i });
      expect(t.getAttribute("aria-checked")).toBe("false");
    }, { timeout: 2000 });
  });
});
