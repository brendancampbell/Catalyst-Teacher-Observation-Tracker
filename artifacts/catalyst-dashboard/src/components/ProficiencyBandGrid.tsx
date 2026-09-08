import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import type { DistrictSchoolRow } from "@workspace/api-types";
import { FilterMultiSelect } from "@/components/FilterMultiSelect";
import { QUERY_KEYS } from "@/lib/queryKeys";
import { fetchDistrictSummary } from "@/lib/api";
import {
  BANDS,
  allRegions,
  buildBandMatrix,
  lensOptionsFor,
  schoolDashboardHref,
  type Lens,
} from "@/lib/proficiencyBands";

const NAVY = "#1034B4";

/* The dashboard's filter-bar furniture, matched rather than approximated. */
const barLabel = "font-bold uppercase tracking-widest shrink-0";
const barLabelStyle = { color: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: "0.03em" } as const;
const dividerStyle  = { width: 1, height: 24, backgroundColor: "#dde3f0" } as const;
const headCellStyle = { boxShadow: "inset 0 -1px 0 #cbd5e1" } as const;

type Level = "overall" | "category" | "domain";

/* Rubric-wide averages every observation on the rubric; walkthroughs narrows to
   walkthrough visits. These are the two the district endpoint already serves —
   see fetchDistrictSummary. */
type Basis = "average" | "walkthroughs";

interface Props {
  rubricSlug: string;
}

/**
 * Every school placed by region and by band.
 *
 * The summary tab answers "how is the network doing"; this answers "which
 * schools do I go to first", which is a different question and needs the
 * schools laid out rather than ranked. A region reads across in one line:
 * how many are fine, how many are slipping, how many need somebody this week.
 *
 * It runs its own query rather than taking the summary's rows, because the
 * walkthrough filter changes what the server aggregates and cannot be applied
 * to a result that has already been averaged.
 */
export default function ProficiencyBandGrid({ rubricSlug }: Props) {
  const [level, setLevel] = useState<Level>("overall");
  const [pick,  setPick]  = useState<string>("");
  const [basis, setBasis] = useState<Basis>("average");

  /* Empty means every region, which is what an unset filter means everywhere
     else on the dashboard. Following that convention rather than inventing a
     second one is also what removes "no regions selected" as a state. */
  const [filterRegion, setFilterRegion] = useState<string[]>([]);

  const { data, isLoading, isError } = useQuery({
    queryKey: [...QUERY_KEYS.districtSummary, rubricSlug, basis, "network-bands"],
    queryFn:  () => fetchDistrictSummary(rubricSlug, basis),
    enabled:  !!rubricSlug,
    staleTime: 60_000,
  });

  const schools    = data?.schools ?? [];
  const categories = data?.categories ?? [];

  const options = useMemo(() => lensOptionsFor(level, categories), [level, categories]);

  /* The second control defaults to its first choice rather than sitting empty,
     so switching level always leaves the grid showing something. */
  const activeId = level === "overall" ? "" : (pick || options[0]?.id || "");

  const lens: Lens = useMemo(() => {
    if (level === "overall" || !activeId) return { kind: "overall" };
    return level === "category" ? { kind: "category", id: activeId } : { kind: "domain", id: activeId };
  }, [level, activeId]);

  /* A pill lands where the district dashboard's own drill-down lands, rather
     than on a second, nearly-identical school view. */
  const basePath = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
  const schoolHref = (school: DistrictSchoolRow) => schoolDashboardHref(school, rubricSlug, basePath);

  const regions = useMemo(() => allRegions(schools), [schools]);

  const rows = useMemo(
    () => buildBandMatrix(schools, lens, categories, filterRegion.length ? filterRegion : null),
    [schools, lens, categories, filterRegion],
  );

  return (
    <div className="space-y-4">
      {/* ── The controls, built like the dashboard's own filter bar: a Bebas
          label, a navy segmented switch, the shared filter menus, and the
          score basis off to the right. ── */}
      <div
        className="bg-white rounded-md px-3 sm:px-4 py-2 sm:py-2.5 flex flex-wrap gap-2 sm:gap-3 items-center"
        style={{ border: "1px solid #dde3f0", borderLeft: `3px solid ${NAVY}` }}
      >
        <span className={barLabel} style={barLabelStyle}>View By</span>

        <div className="flex rounded-md overflow-hidden shrink-0" style={{ border: `1.5px solid ${NAVY}`, fontFamily: "'Bebas Neue', sans-serif" }}>
          {([
            { key: "overall",  label: "Overall" },
            { key: "category", label: "By Group" },
            { key: "domain",   label: "By Domain" },
          ] as { key: Level; label: string }[]).map(({ key, label }, i, arr) => (
            <button
              key={key}
              type="button"
              onClick={() => { setLevel(key); setPick(""); }}
              className="px-3 sm:px-4 py-1.5 font-bold uppercase tracking-wider transition-colors"
              style={{
                backgroundColor: level === key ? NAVY : "transparent",
                color:           level === key ? "white" : NAVY,
                letterSpacing: "0.02em",
                fontSize: 15,
                borderRight: i < arr.length - 1 ? `1px solid ${NAVY}` : undefined,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Which group, or which domain. One choice rather than several, so a
            plain menu dressed as one of the filter buttons beside it. */}
        {level !== "overall" && (
          <select
            value={activeId}
            onChange={(e) => setPick(e.target.value)}
            aria-label={level === "category" ? "Choose a group of domains" : "Choose a domain"}
            className="px-3 py-1.5 rounded font-semibold text-sm max-w-[16rem]"
            style={{ border: "1.5px solid #dde3f0", backgroundColor: "white", color: "#334155", fontFamily: "'Libre Franklin', sans-serif" }}
          >
            {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            {options.length === 0 && <option value="">Nothing on this rubric</option>}
          </select>
        )}

        <div style={dividerStyle} className="hidden sm:block" />

        <span className={barLabel} style={barLabelStyle}>Filters</span>

        <FilterMultiSelect
          label="Region"
          values={filterRegion}
          onChange={setFilterRegion}
          options={regions}
        />

        {filterRegion.length > 0 && (
          <button
            onClick={() => setFilterRegion([])}
            className="font-semibold underline underline-offset-2"
            style={{ color: NAVY, fontSize: 14 }}
          >
            Clear all
          </button>
        )}

        <div style={dividerStyle} className="hidden sm:block" />

        <div className="ml-auto flex rounded-md overflow-hidden shrink-0" style={{ border: `1.5px solid ${NAVY}`, fontFamily: "'Bebas Neue', sans-serif" }}>
          {([
            { key: "average",      label: "Rubric Wide" },
            { key: "walkthroughs", label: "Walkthroughs" },
          ] as { key: Basis; label: string }[]).map(({ key, label }, i, arr) => (
            <button
              key={key}
              type="button"
              onClick={() => setBasis(key)}
              className="px-4 py-1.5 font-bold uppercase tracking-wider transition-colors"
              style={{
                backgroundColor: basis === key ? NAVY : "transparent",
                color:           basis === key ? "white" : NAVY,
                letterSpacing: "0.02em",
                fontSize: 15,
                borderRight: i < arr.length - 1 ? `1px solid ${NAVY}` : undefined,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20 gap-2 text-slate-400">
          <Loader2 size={20} className="animate-spin" /> Loading the network…
        </div>
      )}
      {isError && (
        <p className="text-center py-20 text-red-600 text-sm font-semibold">
          Could not load the network summary.
        </p>
      )}

      {/* ── The grid ── */}
      {!isLoading && !isError && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden" style={{ border: "1px solid #dde3f0" }}>
          {/* Scrolls in both directions inside its own box: five columns do not
              fit a phone, and one region's schools stack tall enough to push
              the header off the top. Capping the height is what gives the
              sticky header something to stick to. */}
          <div className="overflow-auto max-h-[70vh]">
            <table className="w-full min-w-[52rem] border-collapse">
              <thead>
                <tr>
                  {/* border-collapse drops a sticky cell's borders, so the rule
                      under the header is drawn as an inset shadow instead. */}
                  <th
                    className="sticky top-0 z-10 bg-white text-left text-xs font-bold uppercase tracking-wide text-slate-500 px-4 py-2.5 w-32"
                    style={headCellStyle}
                  >
                    Region
                  </th>
                  {BANDS.map((b) => (
                    <th
                      key={b.id}
                      className={`sticky top-0 z-10 text-left text-xs font-bold uppercase tracking-wide px-4 py-2.5 ${b.head}`}
                      style={headCellStyle}
                    >
                      {b.label}
                      {b.range && <span className="font-semibold normal-case opacity-75"> ({b.range})</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  /* Banded rows and a firmer rule between them: the regions were
                     grey on grey and ran together. */
                  <tr
                    key={row.region}
                    className="align-top"
                    style={{
                      backgroundColor: i % 2 === 1 ? "#F8FAFC" : "white",
                      borderTop: i === 0 ? undefined : "1px solid #cbd5e1",
                    }}
                  >
                    <td className="px-4 py-3">
                      <div className="text-sm font-bold" style={{ color: NAVY }}>{row.region}</div>
                      <div className="text-xs text-slate-400">
                        {row.total} school{row.total !== 1 ? "s" : ""}
                      </div>
                    </td>
                    {BANDS.map((b) => {
                      const cell = row.bands[b.id];
                      return (
                        <td key={b.id} className="px-3 py-3">
                          {cell.length === 0 ? (
                            <span className="text-sm text-slate-300">—</span>
                          ) : (
                            <div className="flex flex-col gap-1.5">
                              {cell.map(({ school, score }) => (
                                /* A link rather than a click handler, so a school
                                   opens in a new tab the ordinary way. */
                                <a
                                  key={school.id}
                                  href={schoolHref(school)}
                                  className={`flex items-center justify-between gap-2 rounded px-2 py-1 text-xs font-semibold transition-opacity hover:opacity-80 ${b.chip}`}
                                  title={`${school.name} — ${score !== null ? score.toFixed(2) : "no score yet"}`}
                                >
                                  <span className="truncate">{school.abbreviation || school.name}</span>
                                  <span className="tabular-nums shrink-0">
                                    {score !== null ? score.toFixed(2) : "—"}
                                  </span>
                                </a>
                              ))}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
