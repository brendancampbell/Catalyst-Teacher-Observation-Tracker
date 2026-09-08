/**
 * Which band a school sits in, and the grid that arranges every school by
 * region and band.
 *
 * The network summary used to draw one line at 0.7, so a school at 0.68 and a
 * school at 0.30 looked identical. These are the same two thresholds the
 * school action center's domain bars already use — reused deliberately, so a
 * colour means the same thing on both pages.
 *
 * Kept out of the component because the banding is the part that can be
 * quietly wrong: a school in the wrong column reads as a fact, not a bug.
 */
import type { CategoryEntry, DistrictSchoolRow } from "@workspace/api-types";
import { REGIONS } from "@workspace/api-types";

export const PROFICIENCY_THRESHOLD = 0.7;
export const WARNING_THRESHOLD     = 0.5;

export type BandId = "proficient" | "working" | "needs" | "unscored";

export interface BandMeta {
  id:    BandId;
  label: string;
  /* The scores this band covers, printed in the column header. Null where
     there is no range to state. */
  range: string | null;
  /* Tailwind classes for the column header and for a school chip inside it. */
  head:  string;
  chip:  string;
}

/* Written from the thresholds rather than typed out, so the header can never
   claim a line the banding does not actually draw. The top of the middle band
   is one hundredth below the proficient line because banding happens at two
   decimals — a school at 0.695 prints 0.70 and counts as proficient. */
const TOP_OF_MIDDLE = PROFICIENCY_THRESHOLD - 0.01;

/* Column order is the reading order of the page: best first, then the two
   that need a response, then the schools nobody has been to. */
export const BANDS: readonly BandMeta[] = [
  { id: "proficient", label: "Proficient",        range: `\u2265 ${PROFICIENCY_THRESHOLD.toFixed(2)}`,                    head: "bg-green-50 text-green-800",   chip: "bg-green-600 text-white" },
  { id: "working",    label: "Working Towards",   range: `${WARNING_THRESHOLD.toFixed(2)}\u2013${TOP_OF_MIDDLE.toFixed(2)}`, head: "bg-yellow-50 text-yellow-800", chip: "bg-yellow-300 text-yellow-900" },
  { id: "needs",      label: "Needs Improvement", range: `< ${WARNING_THRESHOLD.toFixed(2)}`,                             head: "bg-red-50 text-red-800",       chip: "bg-red-300 text-red-900" },
  { id: "unscored",   label: "Not Yet Scored",    range: null,                                                           head: "bg-slate-50 text-slate-600",   chip: "bg-slate-200 text-slate-600" },
] as const;

/**
 * Round to the two decimals the grid actually prints, then band.
 *
 * Banding the raw value instead would let a school displaying 0.70 sit under
 * Working Towards, because 0.6951 prints as 0.70 and compares as below 0.7.
 * The number on screen and the column it sits in have to agree.
 */
function r2(score: number): number {
  return Math.round(score * 100) / 100;
}

export function bandFor(score: number | null): BandId {
  if (score === null) return "unscored";
  const s = r2(score);
  if (s >= PROFICIENCY_THRESHOLD) return "proficient";
  if (s >= WARNING_THRESHOLD)     return "working";
  return "needs";
}

/* What the grid is measuring: the whole rubric, one group of domains, or one
   domain on its own. */
export type Lens =
  | { kind: "overall" }
  | { kind: "category"; id: string }
  | { kind: "domain";   id: string };

/**
 * A school's score through one lens.
 *
 * A category has no score of its own on the wire, so it is the mean of the
 * domain averages inside it — every domain weighted equally, matching how the
 * Domain Comparison box already averages across schools. Domains the school
 * has no score for are left out rather than counted as zero; a category with
 * none at all is unscored, not 0.
 */
export function scoreForLens(
  school:     DistrictSchoolRow,
  lens:       Lens,
  categories: readonly CategoryEntry[],
): number | null {
  if (lens.kind === "overall") return school.overall;
  if (lens.kind === "domain")  return school.domainAverages[lens.id] ?? null;

  const category = categories.find((c) => c.id === lens.id);
  if (!category) return null;

  const vals = category.domains
    .map((d) => school.domainAverages[d.id])
    .filter((v): v is number => v != null);

  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/**
 * Every region the grid can draw, in the order it draws them.
 *
 * The five the network is built from, then anything else the data actually
 * carries. An unexpected region has to be offered as a choice as well as
 * drawn, or the filter would be the one thing that could hide it.
 */
export function allRegions(schools: readonly DistrictSchoolRow[]): string[] {
  const extras = [...new Set(schools.map((s) => s.region))]
    .filter((r) => !(REGIONS as readonly string[]).includes(r))
    .sort();
  return [...REGIONS, ...extras];
}

export interface BandedSchool {
  school: DistrictSchoolRow;
  score:  number | null;
  band:   BandId;
}

export interface RegionRow {
  region: string;
  /* Every band is a key, even when empty — the grid draws all four columns
     for every region, so an empty cell has to be an empty list, not absent. */
  bands:  Record<BandId, BandedSchool[]>;
  total:  number;
}

/**
 * Every region as a row, every band as a column.
 *
 * All five regions are drawn whether or not they hold schools, so the grid is
 * the same shape week to week. Any region the data carries that is not one of
 * the five is appended rather than dropped — a school with an unexpected
 * region is a data problem worth seeing, not one worth hiding.
 *
 * regionFilter narrows that to a chosen few. Null means every region; a list
 * means exactly those, and an empty list means none. It filters the rows
 * drawn, not the schools counted inside one, so a region's own counts read the
 * same whether it is shown alone or alongside the others.
 */
export function buildBandMatrix(
  schools:      readonly DistrictSchoolRow[],
  lens:         Lens,
  categories:   readonly CategoryEntry[],
  regionFilter: readonly string[] | null = null,
): RegionRow[] {
  const wanted = allRegions(schools)
    .filter((r) => regionFilter === null || regionFilter.includes(r));

  return wanted.map((region) => {
    const bands = Object.fromEntries(BANDS.map((b) => [b.id, [] as BandedSchool[]])) as Record<BandId, BandedSchool[]>;
    let total = 0;

    for (const school of schools) {
      if (school.region !== region) continue;
      const score = scoreForLens(school, lens, categories);
      bands[bandFor(score)].push({ school, score, band: bandFor(score) });
      total += 1;
    }

    /* Strongest first inside a band, so the school at the bottom of Needs
       Improvement is the last name in the row — the one to go to first. */
    for (const b of BANDS) {
      bands[b.id].sort((a, z) => (z.score ?? 0) - (a.score ?? 0));
    }
    /* Nothing to sort by when unscored; alphabetical is at least stable. */
    bands.unscored.sort((a, z) => a.school.name.localeCompare(z.school.name));

    return { region, bands, total };
  });
}

export interface LensOption { id: string; label: string }

/** The choices behind the second control, for whichever level is picked. */
export function lensOptionsFor(
  level:      "overall" | "category" | "domain",
  categories: readonly CategoryEntry[],
): LensOption[] {
  if (level === "overall")  return [];
  if (level === "category") return categories.map((c) => ({ id: c.id, label: c.label }));
  return categories.flatMap((c) => c.domains.map((d) => ({ id: d.id, label: d.label })));
}
