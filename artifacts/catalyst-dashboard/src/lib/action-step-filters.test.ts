/**
 * The Latest Action Step tab replaced Overdue Action Steps, and the overdue
 * filter is the part of that swap that can silently lose people. The old tab
 * listed one row per overdue STEP; this one lists one row per TEACHER and
 * shows only their most recent step. If the filter looked at the displayed
 * step, a teacher with an overdue step from October and a fresh one from
 * December would vanish from the overdue list entirely — worse than the tab
 * it replaced, and invisible.
 */
import { describe, it, expect } from "vitest";
import { matchesActionStepFilters } from "./action-step-filters";
import type { LatestActionStepRow } from "@workspace/api-types";

const step = (over: Partial<NonNullable<LatestActionStepRow["latestStep"]>> = {}) => ({
  id: 1, text: "Increase wait time", assignedDate: "2026-08-01", dueDate: "2026-09-01",
  status: "open", mastered: false, masteredAt: null, isOverdue: false, daysOverdue: null,
  extensionCount: 0, originalDueDate: "2026-09-01", assignerName: "Coach Diaz", ...over,
});

const row = (over: Partial<LatestActionStepRow> = {}): LatestActionStepRow => ({
  employeeId: "T1", teacherName: "Ada Lovelace", department: "Math",
  gradeLevel: ["6"], schoolName: "Hilltop", hasOverdueStep: false,
  latestStep: step(), ...over,
});

const NONE = { grades: [], departments: [], overdueOnly: false };

describe("matchesActionStepFilters", () => {
  it("keeps everyone when no filter is set", () => {
    expect(matchesActionStepFilters(row(), NONE)).toBe(true);
    expect(matchesActionStepFilters(row({ latestStep: null }), NONE)).toBe(true);
  });

  it("keeps a teacher with no action step at all — the blank row is the point", () => {
    const blank = row({ latestStep: null, gradeLevel: ["7"], department: "ELA" });
    expect(matchesActionStepFilters(blank, { ...NONE, grades: ["7"] })).toBe(true);
    expect(matchesActionStepFilters(blank, { ...NONE, departments: ["ELA"] })).toBe(true);
  });

  describe("overdue", () => {
    it("keeps a teacher whose EARLIER step is overdue but whose newest one is not", () => {
      /* The regression this file exists for. */
      const r = row({ hasOverdueStep: true, latestStep: step({ isOverdue: false }) });
      expect(matchesActionStepFilters(r, { ...NONE, overdueOnly: true })).toBe(true);
    });

    it("drops a teacher with nothing overdue anywhere", () => {
      expect(matchesActionStepFilters(row(), { ...NONE, overdueOnly: true })).toBe(false);
    });

    it("drops a teacher with no steps at all", () => {
      const blank = row({ latestStep: null, hasOverdueStep: false });
      expect(matchesActionStepFilters(blank, { ...NONE, overdueOnly: true })).toBe(false);
    });
  });

  describe("grade", () => {
    it("matches if ANY assigned grade is picked, not all of them", () => {
      const r = row({ gradeLevel: ["6", "7", "8"] });
      expect(matchesActionStepFilters(r, { ...NONE, grades: ["8"] })).toBe(true);
      expect(matchesActionStepFilters(r, { ...NONE, grades: ["11"] })).toBe(false);
    });

    it("treats several picked grades as OR", () => {
      const r = row({ gradeLevel: ["7"] });
      expect(matchesActionStepFilters(r, { ...NONE, grades: ["6", "7"] })).toBe(true);
    });

    it("drops a teacher with no grades recorded once a grade is picked", () => {
      /* grade_level is nullable in production and most teachers were imported
         without one — they must not be treated as matching everything. */
      const r = row({ gradeLevel: [] });
      expect(matchesActionStepFilters(r, { ...NONE, grades: ["6"] })).toBe(false);
      expect(matchesActionStepFilters(r, NONE)).toBe(true);
    });
  });

  describe("department", () => {
    it("matches a picked department and drops the others", () => {
      expect(matchesActionStepFilters(row(), { ...NONE, departments: ["Math"] })).toBe(true);
      expect(matchesActionStepFilters(row(), { ...NONE, departments: ["Science"] })).toBe(false);
    });

    it("drops a teacher with no department once one is picked", () => {
      const r = row({ department: null });
      expect(matchesActionStepFilters(r, { ...NONE, departments: ["Math"] })).toBe(false);
      expect(matchesActionStepFilters(r, NONE)).toBe(true);
    });
  });

  it("ANDs across the three filters", () => {
    const r = row({ department: "Math", gradeLevel: ["6"], hasOverdueStep: true });
    expect(matchesActionStepFilters(r, { grades: ["6"], departments: ["Math"], overdueOnly: true })).toBe(true);
    expect(matchesActionStepFilters(r, { grades: ["6"], departments: ["ELA"], overdueOnly: true })).toBe(false);
  });
});
