import { Footprints } from "lucide-react";
import type { Observation, CategoryEntry } from "@workspace/api-types";
import { richTextToPlainText } from "@workspace/api-types";
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
  actionStepByObservationId,
}: {
  observations: Observation[];
  categories:   CategoryEntry[];
  onSelect:     (obs: Observation) => void;
  noun?:        [string, string];
  /* Action step assigned during each observation, by observation id. Omitted
     by the school-wide history: a school-wide observation has no teacher, so
     there is nobody for a step to be assigned to and the column would be an
     empty stripe. */
  actionStepByObservationId?: Record<string, string>;
}) {
  const showActionStep = actionStepByObservationId !== undefined;
  const { page, setPage, pageSize, setPageSize, totalPages, pageStart, paged } =
    usePagination(observations, 10);

  const th = "px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider";

  return (
    <div>
      <div className="bg-white rounded-xl shadow-sm overflow-hidden" style={{ border: "1px solid #dde3f0" }}>
        <div className="overflow-x-auto">
          <table className={`w-full text-sm ${showActionStep ? "table-fixed" : ""}`}>
            {/* Fixed widths only when the action step is shown: the column has
                to be told to be wide, and truncation needs a width to truncate
                against. Without it the table sizes itself as it always did. */}
            {showActionStep && (
              <colgroup>
                <col style={{ width: "14%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "16%" }} />
                <col style={{ width: "50%" }} />
                <col style={{ width: "9%" }} />
              </colgroup>
            )}
            <thead>
              <tr style={{ backgroundColor: "#f0f3fc", borderBottom: `2px solid ${NAVY}` }}>
                <th className={th} style={{ color: NAVY }}>Date</th>
                <th className={th} style={{ color: NAVY }}>Type</th>
                <th className={th} style={{ color: NAVY }}>Observer</th>
                {showActionStep && <th className={th} style={{ color: NAVY }}>Action Step</th>}
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
                        ? <span className="inline-flex items-center gap-1 text-sm font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: "#EEF1FB", color: NAVY }}>
                            <Footprints size={11} /> Walkthrough
                          </span>
                        : <span className="text-slate-500">Observation</span>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 truncate">{obs.observer}</td>
                    {showActionStep && (
                      /* One line, always. A step can run to a paragraph, and a
                         row that grows to fit one undoes the compactness the
                         table exists for — the whole text is in the pop-up the
                         row opens, and in the title for a hover. A formatted
                         step has no room for its bullets here, so both are
                         shown as plain text. */
                      <td
                        className="px-4 py-2.5 text-slate-600 truncate"
                        title={actionStepByObservationId![obs.id] != null ? richTextToPlainText(actionStepByObservationId![obs.id]) : undefined}
                      >
                        {actionStepByObservationId![obs.id] != null
                          ? richTextToPlainText(actionStepByObservationId![obs.id], { singleLine: true })
                          : <span className="text-slate-300">—</span>}
                      </td>
                    )}
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {avg !== null
                        ? <span className={`inline-block px-2 py-0.5 rounded font-bold text-sm ${getScoreColor(avg)}`}>
                            {avg.toFixed(1)}
                          </span>
                        : <span className="text-sm text-slate-400 italic">not scored</span>}
                    </td>
                  </tr>
                );
              })}
              {observations.length === 0 && (
                <tr><td colSpan={showActionStep ? 5 : 4} className="px-4 py-8 text-center text-sm text-slate-400">
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
