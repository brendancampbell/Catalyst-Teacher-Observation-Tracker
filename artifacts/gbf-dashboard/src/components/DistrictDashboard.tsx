import { useState, useMemo } from "react";
import { ChevronDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fetchDistrictSummary, fetchQuarters, REGIONS, GRADE_SPANS } from "@/lib/api";
import type { DistrictSummaryData, DistrictSchoolRow, RubricQuarterRow } from "@/lib/api";
import { getScoreColor } from "@/components/ScoreCell";
import { FilterMultiSelect } from "@/components/FilterMultiSelect";
import { useUser } from "@/context/UserContext";

const NAVY   = "#1034B4";
const YELLOW = "#FFB500";

const REGION_ORDER    = ["Boston", "Camden", "NYC", "Newark", "Rochester"] as const;
const GRADE_SPAN_ORDER = ["ES", "MS", "HS"] as const;

type DistrictViewBy = "school" | "region" | "gradeSpan";
type ScoreType      = "recent" | "average";

interface DisplayRow {
  key:           string;
  label:         string;
  subLabel:      string;
  isClickable:   boolean;
  schoolId?:     number;
  domainAverages: Record<string, number | null>;
  overall:       number | null;
  teacherCount:  number;
  observedCount: number;
}

/* Build the rows to display based on the current view-by setting */
function buildDisplayRows(
  schools:  DistrictSchoolRow[],
  viewBy:   DistrictViewBy,
  allSlugs: string[],
): DisplayRow[] {
  if (viewBy === "school") {
    return schools.map((s) => ({
      key:           String(s.id),
      label:         s.name,
      subLabel:      `${s.teacherCount} teacher${s.teacherCount !== 1 ? "s" : ""} · ${s.observedCount} observed`,
      isClickable:   true,
      schoolId:      s.id,
      domainAverages: s.domainAverages,
      overall:       s.overall,
      teacherCount:  s.teacherCount,
      observedCount: s.observedCount,
    }));
  }

  const groupKey = viewBy === "region" ? "region" : "gradeSpan";
  const ORDER    = viewBy === "region" ? REGION_ORDER : GRADE_SPAN_ORDER;

  const groups = new Map<string, DistrictSchoolRow[]>();
  for (const s of schools) {
    const k = s[groupKey] || "Other";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(s);
  }

  const result: DisplayRow[] = [];
  for (const key of ORDER) {
    const grp = groups.get(key);
    if (!grp) continue;

    /* Average domain scores across schools in group */
    const domainSums:   Record<string, number> = {};
    const domainCounts: Record<string, number> = {};
    for (const s of grp) {
      for (const [slug, val] of Object.entries(s.domainAverages)) {
        if (val != null) {
          domainSums[slug]   = (domainSums[slug]   ?? 0) + val;
          domainCounts[slug] = (domainCounts[slug] ?? 0) + 1;
        }
      }
    }

    const domainAverages: Record<string, number | null> = {};
    let totalSum = 0, totalCount = 0;
    for (const slug of allSlugs) {
      const cnt = domainCounts[slug] ?? 0;
      if (cnt > 0) {
        const avg = domainSums[slug] / cnt;
        domainAverages[slug] = Math.round(avg * 10) / 10;
        totalSum += avg;
        totalCount += 1;
      } else {
        domainAverages[slug] = null;
      }
    }

    const overall      = totalCount > 0 ? Math.round((totalSum / totalCount) * 10) / 10 : null;
    const teacherCount  = grp.reduce((s, r) => s + r.teacherCount,  0);
    const observedCount = grp.reduce((s, r) => s + r.observedCount, 0);

    const label = viewBy === "gradeSpan"
      ? (key === "ES" ? "Elementary (ES)" : key === "MS" ? "Middle (MS)" : "High School (HS)")
      : key;

    result.push({
      key,
      label,
      subLabel:      `${grp.length} school${grp.length !== 1 ? "s" : ""} · ${teacherCount} teachers`,
      isClickable:   false,
      domainAverages,
      overall,
      teacherCount,
      observedCount,
    });
  }
  return result;
}

/* ═══════════════════════════════════════════════════════════════
   Component
   ═══════════════════════════════════════════════════════════════ */

interface Props {
  onDrillDown: (schoolId: number, schoolName: string) => void;
}

export default function DistrictDashboard({ onDrillDown }: Props) {
  const { currentUser, users, setCurrentUser } = useUser();
  const [userMenuOpen,  setUserMenuOpen]  = useState(false);
  const [activeQuarter, setActiveQuarter] = useState("Q1");
  const [viewBy,          setViewBy]          = useState<DistrictViewBy>("school");
  const [scoreType,       setScoreType]       = useState<ScoreType>("recent");
  const [filterRegion,    setFilterRegion]    = useState<string[]>([]);
  const [filterGradeSpan, setFilterGradeSpan] = useState<string[]>([]);

  function handleViewByChange(mode: DistrictViewBy) {
    setViewBy(mode);
    if (mode === "region")    setFilterRegion([]);
    if (mode === "gradeSpan") setFilterGradeSpan([]);
  }

  const baseUrl = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

  const { data: quarters = [] } = useQuery<RubricQuarterRow[]>({
    queryKey: ["quarters"],
    queryFn: fetchQuarters,
    staleTime: 60_000,
  });

  const { data, isLoading, isError } = useQuery<DistrictSummaryData>({
    queryKey: ["district", activeQuarter, scoreType],
    queryFn: () => fetchDistrictSummary(activeQuarter, scoreType),
    staleTime: 30_000,
  });

  const allDomains = useMemo(() => (data?.categories ?? []).flatMap((c) => c.domains), [data]);
  const allSlugs   = useMemo(() => allDomains.map((d) => d.id), [allDomains]);

  /* Apply region + gradeSpan filters to school rows */
  const filteredSchools = useMemo(() => {
    let rows = data?.schools ?? [];
    if (filterRegion.length    > 0) rows = rows.filter((s) => filterRegion.includes(s.region));
    if (filterGradeSpan.length > 0) rows = rows.filter((s) => filterGradeSpan.includes(s.gradeSpan));
    return rows;
  }, [data, filterRegion, filterGradeSpan]);

  const displayRows = useMemo(
    () => buildDisplayRows(filteredSchools, viewBy, allSlugs),
    [filteredSchools, viewBy, allSlugs],
  );

  /* ── Derived stats (always from filtered school rows) ────── */
  const schoolCount    = filteredSchools.length;
  const districtAvgRaw = (() => {
    const rows = filteredSchools.filter((r) => r.overall != null);
    if (!rows.length) return null;
    return rows.reduce((s, r) => s + r.overall!, 0) / rows.length;
  })();
  const proficient   = filteredSchools.filter((s) => s.overall != null && s.overall >= 3).length;
  const needsSupport = filteredSchools.filter((s) => s.overall != null && s.overall <  2).length;

  /* First column label */
  const firstColLabel =
    viewBy === "school"    ? "School" :
    viewBy === "region"    ? "Region" :
    "Grade Span";

  /* ── Render ────────────────────────────────────────────── */
  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#F4F6FB", fontFamily: "'Libre Franklin', sans-serif" }}>

      {/* ══ HEADER ═══════════════════════════════════════════ */}
      <div style={{ height: 5, backgroundColor: YELLOW }} />

      <header style={{ backgroundColor: NAVY }} className="sticky top-0 z-30 shrink-0 shadow-md">
        <div className="px-3 sm:px-5 py-3 sm:py-4 flex items-center justify-between gap-2">

          {/* Left: logo + title */}
          <div className="flex items-center gap-3 sm:gap-5 min-w-0">
            <img
              src="/uncommon-logo.png"
              alt="Uncommon Schools"
              className="h-8 sm:h-12 w-auto object-contain shrink-0"
              style={{ filter: "brightness(0) invert(1)" }}
            />
            <div className="hidden sm:block" style={{ width: 1, height: 40, backgroundColor: "rgba(255,181,0,0.45)" }} />
            <div className="hidden sm:block min-w-0">
              <p
                className="text-white uppercase tracking-widest leading-tight"
                style={{ fontFamily: "'Bebas Neue', sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: "0.04em" }}
              >
                Get Better Faster Tracker
              </p>
              <p className="text-blue-200 font-medium truncate" style={{ fontSize: 15 }}>
                District Overview
              </p>
            </div>
          </div>

          {/* Right: Admin + user switcher */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <a
              href={`${baseUrl}/admin`}
              className="hidden sm:flex items-center gap-1 font-bold rounded-md px-3 py-2 transition-opacity hover:opacity-80"
              style={{
                border: `1.5px solid rgba(255,181,0,0.5)`,
                color: YELLOW,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 14,
                letterSpacing: "0.02em",
              }}
            >
              Admin
            </a>

            {/* User switcher */}
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen((p) => !p)}
                className="flex items-center gap-2 rounded px-2 sm:px-3 py-1.5"
                style={{ backgroundColor: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)" }}
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                  style={{ backgroundColor: YELLOW, color: NAVY }}
                >
                  {currentUser ? currentUser.name.split(" ").map((w) => w[0]).slice(0, 2).join("") : "…"}
                </div>
                <span className="text-white font-medium hidden sm:block" style={{ fontSize: 15 }}>
                  {currentUser?.name ?? "Loading…"}
                </span>
                <span
                  className="font-semibold rounded-full px-2.5 py-0.5 hidden md:block"
                  style={{ backgroundColor: YELLOW, color: NAVY, fontSize: 11 }}
                >
                  {currentUser?.role?.replace("_", " ") ?? ""}
                </span>
                <ChevronDown size={14} className="text-white/70 hidden sm:block" />
              </button>

              {userMenuOpen && (
                <div
                  className="absolute right-0 top-full mt-1 rounded-lg shadow-xl z-50 min-w-[200px] overflow-hidden"
                  style={{ backgroundColor: NAVY, border: `1.5px solid ${YELLOW}` }}
                >
                  {users.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => { setCurrentUser(u); setUserMenuOpen(false); }}
                      className="w-full text-left px-4 py-2.5 flex flex-col gap-0.5 hover:bg-white/10 transition-colors"
                    >
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

      {/* ══ MAIN ═════════════════════════════════════════════ */}
      <main className="px-3 sm:px-5 py-3 sm:py-4 flex flex-col gap-3 flex-1 min-h-0">

        {/* ── Quarter Switcher ─────────────────────────────── */}
        {quarters.length > 0 && (
          <div
            className="bg-white rounded-md px-3 sm:px-4 py-2 flex flex-wrap items-center gap-2"
            style={{ border: "1px solid #dde3f0", borderLeft: `3px solid ${YELLOW}` }}
          >
            <span
              className="font-bold uppercase tracking-widest shrink-0"
              style={{ color: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, letterSpacing: "0.03em" }}
            >
              Quarter
            </span>
            <div className="flex gap-1.5 flex-wrap">
              {quarters.map((q) => {
                const active = q.slug === activeQuarter;
                return (
                  <button
                    key={q.slug}
                    type="button"
                    onClick={() => setActiveQuarter(q.slug)}
                    className="px-3 py-1 font-bold uppercase tracking-wide rounded transition-colors"
                    style={{
                      fontFamily: "'Bebas Neue', sans-serif",
                      fontSize: 14,
                      letterSpacing: "0.04em",
                      backgroundColor: active ? NAVY : "transparent",
                      color: active ? "white" : NAVY,
                      border: `1.5px solid ${NAVY}`,
                    }}
                  >
                    {q.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Stats ────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-2.5">
          {[
            { label: "Schools",           value: schoolCount,                                                    colorScore: null as number | null, pct: null as number | null },
            { label: "Average Score",     value: districtAvgRaw != null ? districtAvgRaw.toFixed(1) : "—",    colorScore: districtAvgRaw,        pct: null },
            { label: "Proficient+ (≥ 3)", value: proficient,                                                   colorScore: null,                  pct: schoolCount ? Math.round(proficient   / schoolCount * 100) : null },
            { label: "Need Support (< 2)", value: needsSupport,                                                colorScore: null,                  pct: schoolCount ? Math.round(needsSupport / schoolCount * 100) : null },
          ].map(({ label, value, colorScore, pct }) => (
            <div
              key={label}
              className="bg-white rounded-md shadow-sm overflow-hidden"
              style={{ border: "1px solid #dde3f0", borderTop: `3px solid ${NAVY}` }}
            >
              <div className="px-4 py-3">
                <p className="uppercase tracking-wide font-semibold" style={{ color: "#64748b", fontSize: 13 }}>
                  {label}
                </p>
                {pct !== null ? (
                  <div className="flex items-center gap-0 mt-1">
                    <span className="flex-1 text-center font-bold leading-none py-1" style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY, fontWeight: 800, fontSize: 36, borderRight: `2px solid #dde3f0` }}>
                      {value}
                    </span>
                    <span className="flex-1 text-center font-bold leading-none py-1" style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY, fontWeight: 800, fontSize: 36 }}>
                      {pct}%
                    </span>
                  </div>
                ) : colorScore !== null ? (
                  <span
                    className={`inline-block font-bold mt-1 leading-none px-3 py-1 rounded-md ${getScoreColor(colorScore)}`}
                    style={{ fontFamily: "'Bebas Neue', sans-serif", fontWeight: 800, fontSize: 36 }}
                  >
                    {value}
                  </span>
                ) : (
                  <p className="font-bold mt-1 leading-none" style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY, fontWeight: 800, fontSize: 36 }}>
                    {value}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* ── View By + Score Type toggles ─────────────────── */}
        <div
          className="bg-white rounded-md px-3 sm:px-4 py-2 sm:py-2.5 flex flex-wrap gap-2 sm:gap-3 items-center"
          style={{ border: "1px solid #dde3f0", borderLeft: `3px solid ${NAVY}` }}
        >
          {/* View By label + pills */}
          <span
            className="font-bold uppercase tracking-widest shrink-0"
            style={{ color: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, letterSpacing: "0.03em" }}
          >
            View By
          </span>
          <div className="flex rounded-md overflow-hidden shrink-0" style={{ border: `1.5px solid ${NAVY}`, fontFamily: "'Bebas Neue', sans-serif" }}>
            {(["school", "region", "gradeSpan"] as DistrictViewBy[]).map((mode, i, arr) => (
              <button
                key={mode}
                type="button"
                onClick={() => handleViewByChange(mode)}
                className="px-3 sm:px-4 py-1.5 font-bold uppercase tracking-wider transition-colors"
                style={{
                  backgroundColor: viewBy === mode ? NAVY : "transparent",
                  color: viewBy === mode ? "white" : NAVY,
                  letterSpacing: "0.02em",
                  fontSize: 13,
                  borderRight: i < arr.length - 1 ? `1px solid ${NAVY}` : undefined,
                }}
              >
                {mode === "school" ? "School" : mode === "region" ? "Region" : "Grade Span"}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div style={{ width: 1, height: 24, backgroundColor: "#dde3f0" }} className="hidden sm:block" />

          {/* Filters label */}
          <span
            className="font-bold uppercase tracking-widest shrink-0"
            style={{ color: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, letterSpacing: "0.03em" }}
          >
            Filters
          </span>

          {/* Region filter — hidden when grouping by region */}
          {viewBy !== "region" && (
            <FilterMultiSelect
              label="Region"
              values={filterRegion}
              onChange={setFilterRegion}
              options={[...REGIONS]}
            />
          )}

          {/* Grade Span filter — hidden when grouping by grade span */}
          {viewBy !== "gradeSpan" && (
            <FilterMultiSelect
              label="Grade Span"
              values={filterGradeSpan}
              onChange={setFilterGradeSpan}
              options={[...GRADE_SPANS]}
            />
          )}

          {/* Clear all */}
          {(filterRegion.length > 0 || filterGradeSpan.length > 0) && (
            <button
              onClick={() => { setFilterRegion([]); setFilterGradeSpan([]); }}
              className="font-semibold underline underline-offset-2"
              style={{ color: NAVY, fontSize: 14 }}
            >
              Clear all
            </button>
          )}

          {/* Divider before score toggle */}
          <div style={{ width: 1, height: 24, backgroundColor: "#dde3f0" }} className="hidden sm:block" />

          {/* Most Recent / Quarter Avg — right-aligned */}
          <div className="ml-auto flex rounded-md overflow-hidden shrink-0" style={{ border: `1.5px solid ${NAVY}`, fontFamily: "'Bebas Neue', sans-serif" }}>
            {(["recent", "average"] as ScoreType[]).map((mode, i) => (
              <button
                key={mode}
                type="button"
                onClick={() => setScoreType(mode)}
                className="px-4 py-1.5 font-bold uppercase tracking-wider transition-colors"
                style={{
                  backgroundColor: scoreType === mode ? NAVY : "transparent",
                  color: scoreType === mode ? "white" : NAVY,
                  letterSpacing: "0.02em",
                  fontSize: 13,
                  borderRight: i === 0 ? `1px solid ${NAVY}` : undefined,
                }}
              >
                {mode === "recent" ? "Most Recent" : "Quarter Avg"}
              </button>
            ))}
          </div>
        </div>

        {/* ── Loading / Error ──────────────────────────────── */}
        {isLoading && (
          <div className="flex-1 flex items-center justify-center py-20">
            <div className="inline-block w-10 h-10 rounded-full border-4 border-blue-200 animate-spin" style={{ borderTopColor: NAVY }} />
          </div>
        )}
        {isError && (
          <div className="py-10 text-center text-red-600 font-semibold">Failed to load district summary.</div>
        )}

        {/* ── Grid ─────────────────────────────────────────── */}
        {data && !isLoading && (
          <div
            className="bg-white rounded-md overflow-hidden flex-1 min-h-0 shadow-sm"
            style={{ border: "1px solid #dde3f0" }}
          >
            <div className="overflow-auto h-full">
              <table className="border-collapse text-xs" style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}>
                <thead className="sticky top-0 z-20">

                  {/* Category row */}
                  <tr style={{ backgroundColor: NAVY }}>
                    <th
                      rowSpan={2}
                      className="text-left pl-3 pr-2 uppercase sticky left-0 z-30"
                      style={{
                        width: 200, minWidth: 200,
                        backgroundColor: NAVY,
                        color: "white",
                        borderRight: `2px solid ${YELLOW}`,
                        paddingTop: 8, paddingBottom: 8,
                        fontFamily: "'Bebas Neue', sans-serif",
                        fontWeight: 700,
                        fontSize: 18,
                        letterSpacing: "0.02em",
                      }}
                    >
                      {firstColLabel}
                    </th>

                    {data.categories.map((cat) => (
                      <th
                        key={cat.id}
                        colSpan={cat.domains.length}
                        className="text-center font-bold uppercase tracking-wider text-white"
                        style={{
                          fontFamily: "'Bebas Neue', sans-serif",
                          fontSize: 18,
                          letterSpacing: "0.02em",
                          borderLeft: `2px solid ${YELLOW}`,
                          paddingTop: 8, paddingBottom: 8,
                          backgroundColor: NAVY,
                        }}
                      >
                        {cat.label}
                      </th>
                    ))}

                    <th
                      rowSpan={2}
                      className="text-center text-white uppercase"
                      style={{
                        width: 54, minWidth: 54,
                        fontFamily: "'Bebas Neue', sans-serif",
                        fontWeight: 700,
                        fontSize: 18,
                        letterSpacing: "0.02em",
                        borderLeft: `2px solid ${YELLOW}`,
                        backgroundColor: NAVY,
                        paddingTop: 8, paddingBottom: 8,
                      }}
                    >
                      AVG
                    </th>
                  </tr>

                  {/* Domain headers — vertical text */}
                  <tr style={{ backgroundColor: "#0d2990" }}>
                    {allDomains.map((domain) => {
                      const isFirstInCat = (data?.categories ?? []).some((c) => c.domains[0]?.id === domain.id);
                      return (
                        <th
                          key={domain.id}
                          style={{
                            width: 68, minWidth: 68, height: 88,
                            color: "#c8d4f5",
                            borderLeft: isFirstInCat ? `2px solid ${YELLOW}` : "1px solid rgba(255,255,255,0.08)",
                            textAlign: "center",
                            verticalAlign: "top",
                            paddingTop: 8,
                            overflow: "visible",
                          }}
                        >
                          <div
                            style={{
                              writingMode: "vertical-rl",
                              transform: "rotate(180deg)",
                              display: "inline-block",
                              height: "80px",
                              whiteSpace: "normal",
                              wordBreak: "break-word",
                              overflow: "visible",
                              fontSize: "11px",
                              fontWeight: 700,
                              lineHeight: 1.3,
                            }}
                          >
                            {domain.label}
                          </div>
                        </th>
                      );
                    })}
                  </tr>

                  {/* Yellow separator */}
                  <tr style={{ height: 3, backgroundColor: YELLOW }}>
                    <td colSpan={allDomains.length + 2} style={{ padding: 0, height: 3, backgroundColor: YELLOW }} />
                  </tr>

                </thead>
                <tbody>
                  {displayRows.map((row, rowIdx) => {
                    const isEven = rowIdx % 2 === 0;
                    return (
                      <tr
                        key={row.key}
                        className="border-b transition-colors"
                        style={{ borderColor: "#e8edf8", backgroundColor: isEven ? "#ffffff" : "#f7f9fd" }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#eef2fc")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = isEven ? "#ffffff" : "#f7f9fd")}
                      >
                        {/* First column (school / region / grade span) */}
                        <td
                          className="pl-3 pr-2 py-1.5 sticky left-0 z-10"
                          style={{ width: 200, backgroundColor: isEven ? "#ffffff" : "#f7f9fd", borderRight: `2px solid ${YELLOW}` }}
                        >
                          {row.isClickable ? (
                            <button
                              className="font-semibold leading-tight truncate text-left w-full hover:underline"
                              style={{ color: NAVY, fontSize: 15, cursor: "pointer" }}
                              onClick={() => row.schoolId != null && onDrillDown(row.schoolId, row.label)}
                            >
                              {row.label}
                            </button>
                          ) : (
                            <span
                              className="font-semibold leading-tight truncate block"
                              style={{ color: NAVY, fontSize: 15 }}
                            >
                              {row.label}
                            </span>
                          )}
                          <p className="text-slate-400 mt-px" style={{ fontSize: 12 }}>
                            {row.subLabel}
                          </p>
                        </td>

                        {/* Domain average cells — full-cell coloring */}
                        {allDomains.map((domain) => {
                          const val = row.domainAverages[domain.id] ?? null;
                          const isFirstInCat = (data?.categories ?? []).some((c) => c.domains[0]?.id === domain.id);
                          const borderStyle  = isFirstInCat ? { borderLeft: `2px solid ${YELLOW}` } : { borderLeft: "1px solid #e8edf8" };
                          return val != null ? (
                            <td
                              key={domain.id}
                              className={`text-center py-2 text-xl font-bold tabular-nums ${getScoreColor(val)}`}
                              style={{ ...borderStyle, fontFamily: "'Bebas Neue', sans-serif" }}
                            >
                              {val.toFixed(1)}
                            </td>
                          ) : (
                            <td key={domain.id} className="text-center text-slate-300 py-2" style={borderStyle}>—</td>
                          );
                        })}

                        {/* AVG column — full-cell coloring */}
                        {row.overall != null ? (
                          <td
                            className={`text-center text-xl font-bold py-2 ${getScoreColor(row.overall)}`}
                            style={{ borderLeft: `2px solid ${YELLOW}`, fontFamily: "'Bebas Neue', sans-serif" }}
                          >
                            {row.overall.toFixed(1)}
                          </td>
                        ) : (
                          <td className="text-center text-slate-300 py-2" style={{ borderLeft: `2px solid ${YELLOW}` }}>—</td>
                        )}
                      </tr>
                    );
                  })}

                  {displayRows.length === 0 && (
                    <tr>
                      <td colSpan={allDomains.length + 2} className="text-center py-12 text-slate-400 text-sm">
                        No data available for this quarter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
