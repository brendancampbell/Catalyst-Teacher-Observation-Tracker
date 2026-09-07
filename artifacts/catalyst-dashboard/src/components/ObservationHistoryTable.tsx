import { Footprints } from "lucide-react";
import type { Observation, CategoryEntry } from "@workspace/api-types";
import { type Score } from "@/data/dummy";
import { getScoreColor } from "@/components/ScoreCell";
import { TablePagination, usePagination } from "@/components/TablePagination";

const NAVY = "#1034B4";

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

/**
 * The average score of a single observation, over the domains it actually
 * scored.
 *
 * Deliberately not over every domain in the rubric: a walkthrough that looked
 * at two domains out of ten is not a 20% performance, and counting the eight
 * it never opened as zeroes would make every walkthrough look like a disaster.
 */
export function observationAverage(obs: Observation, categories: CategoryEntry[]): number | null {
  const scores = categories
    .flatMap((c) => c.domains)
    .map((d) => obs.scores[d.id] as Score | undefined)
    .filter((s): s is Score => s !== undefined);
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
}

/**
 * An observation history, as a compact table.
 *
 * Replaces a stack of full cards. A teacher observed weekly turned that stack
 * into a page of near-identical blocks that had to be read in full to find one
 * visit; four columns and a click make the same history scannable. The detail
 * modal was always the place the whole observation lived, so nothing is lost —
 * the row is just a shorter way to reach it.
 *
 * Shared by a teacher's history and a school's, exactly as the cards were, so
 * the two lists cannot drift into different shapes.
 */
export function ObservationHistoryTable({
  observations, categories, onSelect, noun = ["observation", "observations"],
}: {
  observations: Observation[];
  categories:   CategoryEntry[];
  onSelect:     (obs: Observation) => void;
  noun?:        [string, string];
}) {
  const { page, setPage, pageSize, setPageSize, totalPages, pageStart, paged } =
    usePagination(observations, 10);

  const th = "px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider";

  return (
    <div>
      <div className="bg-white rounded-xl shadow-sm overflow-hidden" style={{ border: "1px solid #dde3f0" }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: "#f0f3fc", borderBottom: `2px solid ${NAVY}` }}>
                <th className={th} style={{ color: NAVY }}>Date</th>
                <th className={th} style={{ color: NAVY }}>Type</th>
                <th className={th} style={{ color: NAVY }}>Observer</th>
                <th className={`${th} text-right`} style={{ color: NAVY }}>Avg</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paged.map((obs) => {
                const avg = observationAverage(obs, categories);
                return (
                  <tr
                    key={obs.id}
                    className="cursor-pointer hover:bg-slate-50 transition-colors"
                    onClick={() => onSelect(obs)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(obs); } }}
                    aria-label={`View ${obs.isWalkthrough ? "walkthrough" : "observation"} from ${obs.date}`}
                  >
                    <td className="px-4 py-2.5 font-semibold whitespace-nowrap" style={{ color: NAVY }}>
                      {formatDate(obs.date)}
                      {obs.time && <span className="font-normal text-slate-400 ml-1.5">{obs.time}</span>}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {obs.isWalkthrough
                        ? <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: "#EEF1FB", color: NAVY }}>
                            <Footprints size={11} /> Walkthrough
                          </span>
                        : <span className="text-xs text-slate-500">Observation</span>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{obs.observer}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {avg !== null
                        ? <span className={`inline-block px-2 py-0.5 rounded font-bold text-xs ${getScoreColor(avg)}`}>
                            {avg.toFixed(1)}
                          </span>
                        : <span className="text-xs text-slate-400 italic">not scored</span>}
                    </td>
                  </tr>
                );
              })}
              {observations.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-400">
                  No {noun[1]} recorded yet.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Only worth the footer once there is more than one page of history. */}
      {observations.length > 10 && (
        <TablePagination
          total={observations.length}
          page={page}
          pageSize={pageSize}
          pageStart={pageStart}
          totalPages={totalPages}
          onPage={setPage}
          onPageSize={setPageSize}
          noun={noun}
        />
      )}
    </div>
  );
}
