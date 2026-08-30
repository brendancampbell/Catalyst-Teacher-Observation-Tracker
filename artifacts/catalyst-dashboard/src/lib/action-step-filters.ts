import type { LatestActionStepRow } from "@workspace/api-types";

/**
 * Does one teacher's row survive the Latest Action Step filters?
 *
 * Pulled out of the component because the overdue rule is easy to get subtly
 * wrong and expensive to notice: it reads `hasOverdueStep`, which is true when
 * ANY of the teacher's steps is open and past due, NOT when the displayed one
 * is. The tab shows only the most recent step, so filtering on that step alone
 * would hide a teacher who is sitting on an overdue step and has since been
 * given a newer one — the exact case the retired Overdue Action Steps tab
 * caught and the reason it could not simply be dropped.
 *
 * Grade is OR, not AND: a teacher assigned several grades matches if any one
 * of them is picked. Picking 6 and 7 means "anyone who teaches 6 or 7", which
 * is how the dashboard's grade filter already behaves.
 *
 * An empty filter array means "no filter", not "match nothing".
 */
export function matchesActionStepFilters(
  row:     LatestActionStepRow,
  filters: { grades: string[]; departments: string[]; overdueOnly: boolean },
): boolean {
  if (filters.overdueOnly && !row.hasOverdueStep) return false;
  if (filters.departments.length && (!row.department || !filters.departments.includes(row.department))) return false;
  if (filters.grades.length && !row.gradeLevel.some((g) => filters.grades.includes(g))) return false;
  return true;
}
