import { useState } from "react";
import { Building2, ChevronRight, Users, Eye } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fetchDistrictSummary, fetchQuarters } from "@/lib/api";
import type { DistrictSummaryData, RubricQuarterRow } from "@/lib/api";
import { getScoreColor } from "@/components/ScoreCell";
import { useUser } from "@/context/UserContext";

const NAVY   = "#1034B4";
const YELLOW = "#FFB500";

/* ── Avg score display cell ─────────────────────────── */
function AvgCell({ val, size = "md" }: { val: number | null; size?: "sm" | "md" | "lg" }) {
  if (val == null) return (
    <td className="px-3 py-2 text-center">
      <span className="text-slate-300 font-semibold">—</span>
    </td>
  );

  const colorCls = getScoreColor(val);
  const fs = size === "lg" ? 20 : size === "md" ? 16 : 13;

  return (
    <td className="px-2 py-2 text-center">
      <span
        className={`inline-flex items-center justify-center rounded font-bold tabular-nums ${colorCls}`}
        style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: fs, minWidth: size === "lg" ? 48 : 36, padding: "2px 6px" }}
      >
        {val.toFixed(1)}
      </span>
    </td>
  );
}

/* ══ DistrictDashboard ══════════════════════════════════════════════ */

interface Props {
  onDrillDown: (schoolId: number, schoolName: string) => void;
}

export default function DistrictDashboard({ onDrillDown }: Props) {
  const { currentUser, users, setCurrentUser } = useUser();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [activeQuarter, setActiveQuarter] = useState("Q1");

  const { data: quarters = [] } = useQuery<RubricQuarterRow[]>({
    queryKey: ["quarters"],
    queryFn: fetchQuarters,
    staleTime: 60_000,
  });

  const { data, isLoading, isError } = useQuery<DistrictSummaryData>({
    queryKey: ["district", activeQuarter],
    queryFn: () => fetchDistrictSummary(activeQuarter),
    staleTime: 30_000,
  });

  const baseUrl = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

  /* ── Header ─────────────────────────────────────────────────── */
  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#F4F6FB", fontFamily: "'Libre Franklin', sans-serif" }}>
      <div style={{ height: 5, backgroundColor: YELLOW }} />

      <header style={{ backgroundColor: NAVY }} className="sticky top-0 z-30 shadow-md">
        <div className="px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3 sm:gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <Building2 size={22} className="shrink-0" style={{ color: YELLOW }} />
            <div className="min-w-0">
              <p className="text-white font-bold uppercase leading-tight" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: "0.04em" }}>
                Get Better Faster Tracker
              </p>
              <p className="text-blue-200 text-xs font-medium leading-tight uppercase tracking-wide">District Overview</p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2 sm:gap-3 shrink-0">
            <a
              href={`${baseUrl}/admin`}
              className="hidden sm:flex items-center gap-1.5 font-bold rounded-md px-3 py-1.5 transition-opacity hover:opacity-90"
              style={{ backgroundColor: YELLOW, color: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, letterSpacing: "0.03em" }}
            >
              ADMIN
            </a>

            <div className="relative">
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors"
              >
                <div className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs shrink-0" style={{ backgroundColor: YELLOW, color: NAVY, fontFamily: "'Bebas Neue', sans-serif" }}>
                  {currentUser?.name.split(" ").map((w) => w[0]).join("").slice(0, 2) ?? "?"}
                </div>
                <div className="hidden sm:flex flex-col items-start">
                  <span className="text-white font-semibold leading-tight" style={{ fontSize: 13 }}>{currentUser?.name ?? "—"}</span>
                  <span className="font-bold rounded-full px-1.5 text-xs" style={{ backgroundColor: YELLOW, color: NAVY }}>{currentUser?.role?.replace("_", " ")}</span>
                </div>
              </button>
              {userMenuOpen && (
                <div className="absolute right-0 top-full mt-1 rounded-lg shadow-xl z-50 min-w-[200px] overflow-hidden" style={{ backgroundColor: NAVY, border: `1.5px solid ${YELLOW}` }}>
                  {users.map((u) => (
                    <button key={u.id} onClick={() => { setCurrentUser(u); setUserMenuOpen(false); }} className="w-full text-left px-4 py-2.5 flex flex-col gap-0.5 hover:bg-white/10 transition-colors">
                      <span className="text-white font-medium" style={{ fontSize: 14 }}>{u.name}</span>
                      <span style={{ fontSize: 11, color: YELLOW }}>{u.role.replace("_", " ")}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <div style={{ height: 3, backgroundColor: YELLOW }} />
      </header>

      {/* ══ MAIN ═════════════════════════════════════════════════ */}
      <main className="px-3 sm:px-5 py-3 sm:py-4 flex flex-col gap-3 flex-1">

        {/* ── Quarter switcher ─────────────────────────────────── */}
        {quarters.length > 0 && (
          <div className="bg-white rounded-md px-3 sm:px-4 py-2 flex flex-wrap items-center gap-2" style={{ border: "1px solid #dde3f0", borderLeft: `3px solid ${YELLOW}` }}>
            <span className="font-bold uppercase tracking-widest shrink-0" style={{ color: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, letterSpacing: "0.03em" }}>
              Quarter
            </span>
            <div className="flex gap-1.5 flex-wrap">
              {quarters.map((q) => {
                const active = q.slug === activeQuarter;
                return (
                  <button key={q.slug} type="button" onClick={() => setActiveQuarter(q.slug)}
                    className="px-3 py-1 font-bold uppercase tracking-wide rounded transition-colors"
                    style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: "0.04em", backgroundColor: active ? NAVY : "transparent", color: active ? "white" : NAVY, border: `1.5px solid ${NAVY}` }}>
                    {q.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Loading / Error states ─────────────────────────── */}
        {isLoading && (
          <div className="flex-1 flex items-center justify-center py-20">
            <div className="inline-block w-10 h-10 rounded-full border-4 border-blue-200 animate-spin" style={{ borderTopColor: NAVY }} />
          </div>
        )}
        {isError && (
          <div className="py-10 text-center text-red-600 font-semibold">Failed to load district summary.</div>
        )}

        {/* ── District summary grid ──────────────────────────── */}
        {data && !isLoading && (
          <>
            {/* Stats row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-2.5">
              {[
                { label: "Schools",         value: data.schools.length },
                { label: "Total Teachers",  value: data.schools.reduce((s, r) => s + r.teacherCount, 0) },
                { label: "Observed",        value: data.schools.reduce((s, r) => s + r.observedCount, 0) },
                {
                  label: "District Avg",
                  value: (() => {
                    const rows = data.schools.filter((r) => r.overall != null);
                    if (!rows.length) return "—";
                    return (rows.reduce((s, r) => s + r.overall!, 0) / rows.length).toFixed(1);
                  })(),
                },
              ].map(({ label, value }) => (
                <div key={label} className="bg-white rounded-md shadow-sm overflow-hidden" style={{ border: "1px solid #dde3f0", borderTop: `3px solid ${NAVY}` }}>
                  <div className="px-4 py-3">
                    <p className="uppercase tracking-wide font-semibold" style={{ color: "#64748b", fontSize: 13 }}>{label}</p>
                    <p className="font-bold mt-1 leading-none" style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY, fontWeight: 800, fontSize: 36 }}>{value}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Grid table */}
            <div className="bg-white rounded-lg shadow-sm overflow-hidden" style={{ border: "1px solid #dde3f0" }}>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    {/* Category header row */}
                    <tr>
                      <th rowSpan={2} className="px-4 py-3 text-left font-bold uppercase whitespace-nowrap" style={{ backgroundColor: NAVY, color: YELLOW, fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, letterSpacing: "0.03em", borderRight: `2px solid ${YELLOW}`, minWidth: 200 }}>
                        School
                      </th>
                      {data.categories.map((cat) => (
                        <th
                          key={cat.id}
                          colSpan={cat.domains.length}
                          className="px-2 py-2 text-center font-bold uppercase"
                          style={{ backgroundColor: NAVY, color: "white", fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, letterSpacing: "0.02em", borderRight: "1px solid rgba(255,255,255,0.15)", borderBottom: `2px solid ${YELLOW}` }}
                        >
                          {cat.label}
                        </th>
                      ))}
                      <th rowSpan={2} className="px-3 py-2 text-center font-bold uppercase" style={{ backgroundColor: NAVY, color: YELLOW, fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, letterSpacing: "0.02em", borderLeft: `2px solid ${YELLOW}`, minWidth: 72 }}>
                        Overall
                      </th>
                    </tr>
                    {/* Domain header row */}
                    <tr>
                      {data.categories.flatMap((cat) =>
                        cat.domains.map((dom, di) => (
                          <th
                            key={dom.id}
                            className="px-2 py-1 text-center font-semibold"
                            style={{
                              backgroundColor: "#1a3fc4",
                              color: "rgba(255,255,255,0.85)",
                              fontSize: 10,
                              lineHeight: 1.2,
                              maxWidth: 68,
                              borderRight: di === cat.domains.length - 1 ? "1px solid rgba(255,255,255,0.15)" : undefined,
                            }}
                          >
                            <div style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", height: 72, display: "flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap" }}>
                              {dom.label}
                            </div>
                          </th>
                        ))
                      )}
                    </tr>
                  </thead>

                  <tbody>
                    {data.schools.map((school, si) => (
                      <tr
                        key={school.id}
                        className="border-b border-slate-100 hover:bg-blue-50/40 transition-colors"
                        style={{ backgroundColor: si % 2 === 0 ? "white" : "#fafbff" }}
                      >
                        {/* School name — clickable */}
                        <td className="px-4 py-3" style={{ borderRight: `2px solid ${YELLOW}` }}>
                          <button
                            onClick={() => onDrillDown(school.id, school.name)}
                            className="flex items-center gap-2 group text-left w-full"
                          >
                            <div>
                              <p className="font-bold group-hover:underline transition-all" style={{ color: NAVY, fontSize: 14 }}>
                                {school.name}
                              </p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="flex items-center gap-1 text-slate-400" style={{ fontSize: 11 }}>
                                  <Users size={10} /> {school.teacherCount} teachers
                                </span>
                                <span className="flex items-center gap-1 text-slate-400" style={{ fontSize: 11 }}>
                                  <Eye size={10} /> {school.observedCount} observed
                                </span>
                              </div>
                            </div>
                            <ChevronRight size={14} className="ml-auto shrink-0 text-slate-300 group-hover:text-blue-500 transition-colors" />
                          </button>
                        </td>

                        {/* Domain averages */}
                        {data.categories.flatMap((cat) =>
                          cat.domains.map((dom) => (
                            <AvgCell key={dom.id} val={school.domainAverages[dom.id] ?? null} />
                          ))
                        )}

                        {/* Overall avg */}
                        <td className="px-2 py-2 text-center" style={{ borderLeft: `2px solid ${YELLOW}` }}>
                          {school.overall != null ? (
                            <span
                              className={`inline-flex items-center justify-center rounded font-bold tabular-nums ${getScoreColor(school.overall)}`}
                              style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, minWidth: 48, padding: "2px 6px" }}
                            >
                              {school.overall.toFixed(1)}
                            </span>
                          ) : (
                            <span className="text-slate-300 font-semibold">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Color legend */}
              <div className="px-4 py-2 border-t border-slate-100 flex flex-wrap items-center gap-3">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Score Key</span>
                {[
                  { range: "4.0 — Exemplary",    cls: "bg-green-700 text-white" },
                  { range: "3.0 — Proficient",   cls: "bg-green-400 text-white" },
                  { range: "2.0 — Developing",   cls: "bg-yellow-200 text-yellow-900" },
                  { range: "1.0 — Beginning",    cls: "bg-red-200 text-red-800" },
                ].map(({ range, cls }) => (
                  <span key={range} className={`text-xs font-semibold px-2 py-0.5 rounded ${cls}`}>{range}</span>
                ))}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
