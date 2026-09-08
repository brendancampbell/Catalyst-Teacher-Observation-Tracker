import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Grid3x3, Loader2 } from "lucide-react";
import { QUERY_KEYS } from "@/lib/queryKeys";
import { fetchDistrictSummary } from "@/lib/api";
import {
  BANDS,
  allRegions,
  buildBandMatrix,
  lensOptionsFor,
  type Lens,
} from "@/lib/proficiencyBands";

const NAVY   = "#1034B4";
const YELLOW = "#FFB500";

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

  /* Null rather than a full list, because the regions are not known until the
     query lands. Null means every region there turns out to be. */
  const [picked, setPicked] = useState<string[] | null>(null);

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

  const regions = useMemo(() => allRegions(schools), [schools]);

  const rows = useMemo(
    () => buildBandMatrix(schools, lens, categories, picked),
    [schools, lens, categories, picked],
  );

  const isOn = (r: string) => picked === null || picked.includes(r);

  /* Toggling back up to the full set stores null again, so "all regions"
     is one state rather than two that look the same. */
  const toggleRegion = (r: string) => {
    const base = picked ?? regions;
    const next = base.includes(r) ? base.filter((x) => x !== r) : [...base, r];
    setPicked(next.length === regions.length ? null : next);
  };

  const selectClass = "border border-slate-200 rounded px-2 py-1.5 text-sm bg-white";

  return (
    <div className="space-y-4">
      {/* ── The controls ── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-600">Measure by</span>
        <select
          value={level}
          onChange={(e) => { setLevel(e.target.value as Level); setPick(""); }}
          aria-label="Measure by"
          className={selectClass}
        >
          <option value="overall">Overall</option>
          <option value="category">Group of domains</option>
          <option value="domain">Individual domain</option>
        </select>

        {level !== "overall" && (
          <select
            value={activeId}
            onChange={(e) => setPick(e.target.value)}
            aria-label={level === "category" ? "Choose a group of domains" : "Choose a domain"}
            className={`${selectClass} max-w-[18rem]`}
          >
            {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            {options.length === 0 && <option value="">Nothing on this rubric</option>}
          </select>
        )}

        {/* Two states, so a switch rather than a menu — and the same switch the
            school action center puts above its domain comparison. */}
        <div
          className="flex items-center gap-0.5 rounded-lg p-0.5 ml-auto"
          style={{ backgroundColor: "#f1f5f9" }}
          role="group"
          aria-label="Observations to include"
        >
          {([
            { key: "average",      label: "Rubric wide" },
            { key: "walkthroughs", label: "Walkthroughs" },
          ] as { key: Basis; label: string }[]).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setBasis(key)}
              aria-pressed={basis === key}
              className="px-3 py-1.5 text-xs font-semibold rounded-md transition-all"
              style={{
                backgroundColor: basis === key ? "white" : "transparent",
                color:           basis === key ? NAVY : "#64748b",
                boxShadow:       basis === key ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Regions, on their own line: five of them will not share a row with
          the rest of the controls on anything narrower than a laptop. ── */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-semibold text-slate-600 mr-1">Regions</span>
        <button
          type="button"
          onClick={() => setPicked(null)}
          aria-pressed={picked === null}
          className="px-3 py-1 text-xs font-semibold rounded-full border transition-colors"
          style={{
            backgroundColor: picked === null ? NAVY : "white",
            color:           picked === null ? "white" : "#64748b",
            borderColor:     picked === null ? NAVY : "#dde3f0",
          }}
        >
          All
        </button>
        {regions.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => toggleRegion(r)}
            aria-pressed={isOn(r)}
            className="px-3 py-1 text-xs font-semibold rounded-full border transition-colors"
            style={{
              backgroundColor: isOn(r) ? "#EEF2FF" : "white",
              color:           isOn(r) ? NAVY : "#94a3b8",
              borderColor:     isOn(r) ? NAVY : "#dde3f0",
            }}
          >
            {r}
          </button>
        ))}
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

      {!isLoading && !isError && rows.length === 0 && (
        <p className="text-center py-16 text-sm text-slate-400">
          No regions selected. Pick at least one above.
        </p>
      )}

      {/* ── The grid ── */}
      {!isLoading && !isError && rows.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden" style={{ border: "1px solid #dde3f0" }}>
          <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: `3px solid ${NAVY}`, borderLeft: `4px solid ${YELLOW}` }}>
            <Grid3x3 size={16} style={{ color: NAVY }} />
            <h2 className="font-bold uppercase tracking-wide" style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY, fontSize: 18, letterSpacing: "0.02em" }}>
              Schools by Band
            </h2>
          </div>

          {/* Five columns do not fit a phone, so the table scrolls inside its own
              box rather than pushing the page sideways. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] border-collapse">
              <thead>
                <tr>
                  <th className="text-left text-xs font-bold uppercase tracking-wide text-slate-500 px-4 py-2.5 border-b border-slate-200 w-32">
                    Region
                  </th>
                  {BANDS.map((b) => (
                    <th
                      key={b.id}
                      className={`text-left text-xs font-bold uppercase tracking-wide px-4 py-2.5 border-b border-slate-200 ${b.head}`}
                    >
                      {b.label}
                      {b.range && <span className="font-semibold normal-case opacity-75"> ({b.range})</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.region} className="align-top">
                    <td className="px-4 py-3">
                      <div className="text-sm font-bold text-slate-700">{row.region}</div>
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
                                <div
                                  key={school.id}
                                  className={`flex items-center justify-between gap-2 rounded px-2 py-1 text-xs font-semibold ${b.chip}`}
                                  title={`${school.name} — ${score !== null ? score.toFixed(2) : "no score yet"}`}
                                >
                                  <span className="truncate">{school.abbreviation || school.name}</span>
                                  <span className="tabular-nums shrink-0">
                                    {score !== null ? score.toFixed(2) : "—"}
                                  </span>
                                </div>
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
