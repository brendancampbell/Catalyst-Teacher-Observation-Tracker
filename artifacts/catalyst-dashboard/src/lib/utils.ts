import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Canonical overall average: average of per-category sub-averages.
 *
 * Pass a flat scores map (domainId → numeric score) and the rubric
 * category structure. Categories with no scored domains are skipped.
 * Returns null when no scored domains exist across all categories.
 */
export function calcOverallAvgFromScores(
  scores: Record<string, number | undefined>,
  categories: Array<{ domains: Array<{ id: string }> }>,
): number | null {
  const catAvgs = categories
    .map((c) => {
      const vals = c.domains
        .map((d) => scores[d.id])
        .filter((v): v is number => v !== undefined);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    })
    .filter((v): v is number => v !== null);
  return catAvgs.length ? catAvgs.reduce((a, b) => a + b, 0) / catAvgs.length : null;
}
