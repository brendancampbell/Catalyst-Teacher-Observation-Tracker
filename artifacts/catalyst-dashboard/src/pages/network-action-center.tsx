import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart2, Activity, Building2, Loader2 } from "lucide-react";
import AppHeader from "@/components/AppHeader";
import { UsageTable } from "@/components/UsageTable";
import { useUser } from "@/context/UserContext";
import { QUERY_KEYS } from "@/lib/queryKeys";
import { fetchDistrictSummary, fetchRubricSets } from "@/lib/api";
import { getScoreColor } from "@/components/ScoreCell";
import type { RubricSetRow } from "@/lib/api";

const NAVY   = "#1034B4";
const YELLOW = "#FFB500";

/**
 * The whole organisation, in two tabs.
 *
 * Deliberately not the school action center with a wider filter. Most of that
 * page answers questions that only mean something at one school — who needs
 * rescoring, whose observations are overdue — and a network-wide list of those
 * is a list nobody owns. What survives the widening is the summary and the
 * usage, so that is what this is.
 *
 * Qualitative Trends is absent by request. The Network Comparison box, which
 * measures one school against the network, becomes the network's own version
 * of the same question: the schools ranked against each other.
 */
export default function NetworkActionCenterPage() {
  const { currentUser } = useUser();
  const basePath = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

  const [tab, setTab] = useState<"summary" | "usage">("summary");

  const { data: rubricSets = [] } = useQuery<RubricSetRow[]>({
    queryKey: QUERY_KEYS.rubricSets,
    queryFn:  () => fetchRubricSets(),
    staleTime: 5 * 60_000,
  });

  const [slug, setSlug] = useState<string>(() =>
    new URLSearchParams(window.location.search).get("rubric") ?? "");
  const activeSlug = slug || rubricSets[0]?.slug || "";

  const { data, isLoading, isError } = useQuery({
    queryKey: [...QUERY_KEYS.districtSummary, activeSlug, "network-action-center"],
    queryFn:  () => fetchDistrictSummary(activeSlug, "recent"),
    enabled:  !!activeSlug,
    staleTime: 60_000,
  });

  const schools    = data?.schools ?? [];
  const categories = data?.categories ?? [];
  const domains    = useMemo(() => categories.flatMap((c) => c.domains), [categories]);

  /* Every number here is the network's, which is the whole point of the page. */
  const observedTotal = schools.reduce((n, s) => n + s.observedCount, 0);
  const teacherTotal  = schools.reduce((n, s) => n + s.teacherCount, 0);
  const scoredSchools = schools.filter((s) => s.overall !== null);
  const networkAvg = scoredSchools.length
    ? scoredSchools.reduce((a, s) => a + (s.overall ?? 0), 0) / scoredSchools.length
    : null;

  const domainRows = useMemo(() => domains.map((d) => {
    const vals = schools
      .map((s) => s.domainAverages[d.id])
      .filter((v): v is number => v != null);
    return {
      domain: d,
      avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
      schoolsScored: vals.length,
    };
  }), [domains, schools]);

  /* Ranked, not alphabetical: the question this box answers is who is where. */
  const ranked = useMemo(
    () => [...scoredSchools].sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0)),
    [scoredSchools],
  );

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#F4F6FB", fontFamily: "'Libre Franklin', sans-serif" }}>
      <div className="sticky top-0 z-30 shadow-md">
        {currentUser && (
          <AppHeader
            subtitle="Network Action Center"
            backHref={`${basePath}/`}
            backLabel="Network"
            basePath={basePath}
            userName={currentUser.name}
            userEmail={currentUser.email}
            userRole={currentUser.role}
            canAdmin={currentUser.role !== "COACH"}
            rubricSets={rubricSets}
            activeRubricSet={activeSlug}
            onRubricChange={setSlug}
          />
        )}
      </div>

      {/* ── Two tabs, and only two ── */}
      <div className="bg-white border-b border-slate-200 px-4 sm:px-6">
        <div className="flex">
          {([
            { value: "summary", label: "Summary", icon: <BarChart2 size={15} /> },
            { value: "usage",   label: "Usage",   icon: <Activity  size={15} /> },
          ] as const).map(({ value, label, icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className="flex items-center gap-2 px-4 sm:px-5 py-3.5 text-sm font-semibold border-b-2 transition-colors"
              style={{
                color:       tab === value ? NAVY : "#64748b",
                borderColor: tab === value ? NAVY : "transparent",
              }}
            >
              {icon}{label}
            </button>
          ))}
        </div>
      </div>

      <main className="flex-1 px-4 sm:px-6 py-6 space-y-6">
        {tab === "summary" && (
          <>
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

            {!isLoading && !isError && (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                  {[
                    { label: "Network Avg",  value: networkAvg !== null ? networkAvg.toFixed(2) : "—", sub: `${scoredSchools.length} of ${schools.length} schools scored` },
                    { label: "Schools",      value: String(schools.length),  sub: "in the network" },
                    { label: "Observations", value: String(observedTotal),   sub: "on this rubric" },
                    { label: "Teachers",     value: String(teacherTotal),    sub: "on the roster" },
                  ].map(({ label, value, sub }) => (
                    <div key={label} className="rounded-xl px-4 py-3 text-center" style={{ backgroundColor: NAVY }}>
                      <p className="text-blue-300 text-xs uppercase tracking-wider font-semibold">{label}</p>
                      <p className="text-3xl font-bold leading-tight" style={{ color: YELLOW }}>{value}</p>
                      <p className="text-blue-200 text-xs mt-0.5 truncate">{sub}</p>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 sm:gap-5">
                  {/* Domain comparison — the network's own averages */}
                  <div className="lg:col-span-3 bg-white rounded-xl shadow-sm overflow-hidden" style={{ border: "1px solid #dde3f0" }}>
                    <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: `3px solid ${NAVY}`, borderLeft: `4px solid ${YELLOW}` }}>
                      <BarChart2 size={16} style={{ color: NAVY }} />
                      <h2 className="font-bold uppercase tracking-wide" style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY, fontSize: 18, letterSpacing: "0.02em" }}>
                        Domain Comparison
                      </h2>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {domainRows.map(({ domain, avg, schoolsScored }) => (
                        <div key={domain.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                          <span className="text-sm text-slate-700 truncate">{domain.label}</span>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-xs text-slate-400">{schoolsScored} school{schoolsScored !== 1 ? "s" : ""}</span>
                            {avg !== null
                              ? <span className={`font-bold text-sm px-3 py-1 rounded ${getScoreColor(avg)}`}>{avg.toFixed(2)}</span>
                              : <span className="text-sm text-slate-300">—</span>}
                          </div>
                        </div>
                      ))}
                      {domainRows.length === 0 && (
                        <p className="px-4 py-6 text-sm text-slate-400 text-center">No domains on this rubric.</p>
                      )}
                    </div>
                  </div>

                  {/* Where Network Comparison sits on a school's summary. At
                      network level there is nothing outside to compare to, so
                      the schools are compared to each other instead. */}
                  <div className="lg:col-span-2 bg-white rounded-xl shadow-sm overflow-hidden" style={{ border: "1px solid #dde3f0" }}>
                    <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: `3px solid ${NAVY}`, borderLeft: `4px solid ${YELLOW}` }}>
                      <Building2 size={16} style={{ color: NAVY }} />
                      <h2 className="font-bold uppercase tracking-wide" style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY, fontSize: 18, letterSpacing: "0.02em" }}>
                        Schools Ranked
                      </h2>
                    </div>
                    <div className="divide-y divide-slate-100 max-h-[28rem] overflow-y-auto">
                      {ranked.map((s, i) => (
                        <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="text-xs font-bold text-slate-400 w-5 shrink-0">{i + 1}</span>
                            <span className="text-sm text-slate-700 truncate">{s.name}</span>
                          </div>
                          <span className={`font-bold text-sm px-3 py-1 rounded shrink-0 ${getScoreColor(s.overall ?? 0)}`}>
                            {(s.overall ?? 0).toFixed(2)}
                          </span>
                        </div>
                      ))}
                      {ranked.length === 0 && (
                        <p className="px-4 py-6 text-sm text-slate-400 text-center">No school has been scored on this rubric yet.</p>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* Usage already answers this network-wide for network roles — it is
            the same table the school action center shows, unscoped. */}
        {tab === "usage" && <UsageTable schoolId={null} />}
      </main>
    </div>
  );
}
