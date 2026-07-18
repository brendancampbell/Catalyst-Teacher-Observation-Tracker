import { Fragment, useState, useMemo, useLayoutEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchDistrictSummary, fetchRubricSets, REGIONS, GRADE_SPANS } from "@/lib/api";
import type { DistrictSummaryData, DistrictSchoolRow, RubricSetRow, CategoryEntry } from "@/lib/api";
import SchoolObservationModal from "@/components/SchoolObservationModal";
import { getScoreColor, getScoreTextColor } from "@/components/ScoreCell";
import { FilterMultiSelect } from "@/components/FilterMultiSelect";
import { useUser } from "@/context/UserContext";
import AppHeader from "@/components/AppHeader";

const NAVY   = "#1034B4";
const YELLOW = "#FFB500";

const REGION_ORDER    = ["Boston", "Camden", "NYC", "Newark", "Rochester"] as const;
const GRADE_SPAN_ORDER = ["ES", "MS", "HS"] as const;

type DistrictViewBy = "school" | "region" | "gradeSpan";
type ScoreType      = "recent" | "average" | "walkthroughs";

interface DisplayRow {
  key:            string;
  label:          string;
  subLabel:       string;
  isClickable:    boolean;
  schoolId?:      number;
  domainAverages: Record<string, number | null>;
  catSubAvgs:     Record<string, number | null>;
  overall:        number | null;
  teacherCount:   number;
  observedCount:  number;
}

/* Compute category sub-averages from flat domain averages */
function computeCatSubAvgs(
  domainAverages: Record<string, number | null>,
  categories: CategoryEntry[],
): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  for (const cat of categories) {
    const vals = cat.domains
      .map((d) => domainAverages[d.id] ?? null)
      .filter((v): v is number => v !== null);
    result[cat.id] = vals.length
      ? vals.reduce((a, b) => a + b, 0) / vals.length
      : null;
  }
  return result;
}

/* Overall = avg of category sub-averages */
function computeOverall(catSubAvgs: Record<string, number | null>): number | null {
  const vals = Object.values(catSubAvgs).filter((v): v is number => v !== null);
  return vals.length
    ? vals.reduce((a, b) => a + b, 0) / vals.length
    : null;
}

/* Build the rows to display based on the current view-by setting */
function buildDisplayRows(
  schools:        DistrictSchoolRow[],
  viewBy:         DistrictViewBy,
  allSlugs:       string[],
  categories:     CategoryEntry[],
  isSchoolTarget: boolean,
): DisplayRow[] {
  if (viewBy === "school") {
    return schools.map((s) => {
      const catSubAvgs = computeCatSubAvgs(s.domainAverages, categories);
      const subLabel = isSchoolTarget
        ? (s.observedCount === 0 ? "No observations yet" : `${s.observedCount} observation${s.observedCount !== 1 ? "s" : ""} · avg`)
        : `${s.teacherCount} teacher${s.teacherCount !== 1 ? "s" : ""} · ${s.observedCount} observed`;
      return {
        key:           String(s.id),
        label:         s.name,
        subLabel,
        isClickable:   !isSchoolTarget,
        schoolId:      s.id,
        domainAverages: s.domainAverages,
        catSubAvgs,
        overall:       computeOverall(catSubAvgs),
        teacherCount:  s.teacherCount,
        observedCount: s.observedCount,
      };
    });
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
    for (const slug of allSlugs) {
      const cnt = domainCounts[slug] ?? 0;
      domainAverages[slug] = cnt > 0 ? domainSums[slug] / cnt : null;
    }

    const catSubAvgs    = computeCatSubAvgs(domainAverages, categories);
    const overall       = computeOverall(catSubAvgs);
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
      catSubAvgs,
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
  onDrillDown:    (schoolId: number, schoolName: string, schoolGradeSpan?: string, schoolAbbreviation?: string) => void;
  activeRubricSet: string;
  onRubricChange:  (slug: string) => void;
}

export default function DistrictDashboard({ onDrillDown, activeRubricSet, onRubricChange }: Props) {
  const { currentUser } = useUser();

  /* ── Header height measurement for sticky rows ── */
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeaderHeight(el.offsetHeight));
    ro.observe(el);
    setHeaderHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

  const queryClient = useQueryClient();

  const [viewBy,              setViewBy]              = useState<DistrictViewBy>("school");
  const [scoreType,           setScoreType]           = useState<ScoreType>("recent");
  const [filterRegion,        setFilterRegion]        = useState<string[]>([]);
  const [filterGradeSpan,     setFilterGradeSpan]     = useState<string[]>([]);
  const [filterProficiency,   setFilterProficiency]   = useState<string[]>([]);
  const [schoolObsModalOpen,  setSchoolObsModalOpen]  = useState(false);
  const [domainTooltip,       setDomainTooltip]       = useState<{ slug: string; x: number; y: number; description: string } | null>(null);

  function handleViewByChange(mode: DistrictViewBy) {
    setViewBy(mode);
    if (mode === "region")    setFilterRegion([]);
    if (mode === "gradeSpan") setFilterGradeSpan([]);
  }

  const baseUrl = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

  const { data: allRubricSets = [] } = useQuery<RubricSetRow[]>({
    queryKey: ["rubricSets"],
    // fetchRubricSets takes (includeArchived?: boolean); React Query would pass its
    // QueryFunctionContext as that arg, so wrap in an arrow to call with no args.
    queryFn: () => fetchRubricSets(),
    staleTime: 60_000,
  });
  const rubricSets = allRubricSets.filter((q) => !q.isArchived);

  /* Grade spans the active rubric is scoped to (empty = all) */
  const activeRubricSpans = useMemo(() => {
    const obj = rubricSets.find((r) => r.slug === activeRubricSet);
    return obj?.gradeSpan ? obj.gradeSpan.split(",").filter(Boolean) : [];
  }, [rubricSets, activeRubricSet]);


  const { data, isLoading, isError } = useQuery<DistrictSummaryData>({
    queryKey: ["district", activeRubricSet, scoreType],
    queryFn: () => fetchDistrictSummary(activeRubricSet, scoreType),
    staleTime: 30_000,
  });

  const allDomains    = useMemo(() => (data?.categories ?? []).flatMap((c) => c.domains), [data]);
  const allSlugs      = useMemo(() => allDomains.map((d) => d.id), [allDomains]);
  const isSchoolTarget = data?.rubricSet?.target === "SCHOOL";

  /* Apply rubric grade span, then user region + gradeSpan filters */
  const filteredSchools = useMemo(() => {
    let rows = data?.schools ?? [];
    if (activeRubricSpans.length > 0) rows = rows.filter((s) => activeRubricSpans.includes(s.gradeSpan));
    if (filterRegion.length    > 0) rows = rows.filter((s) => filterRegion.includes(s.region));
    if (filterGradeSpan.length > 0) rows = rows.filter((s) => filterGradeSpan.includes(s.gradeSpan));
    return rows;
  }, [data, activeRubricSpans, filterRegion, filterGradeSpan]);

  const allCategories = useMemo(() => data?.categories ?? [], [data]);

  const displayRows = useMemo(
    () => buildDisplayRows(filteredSchools, viewBy, allSlugs, allCategories, isSchoolTarget),
    [filteredSchools, viewBy, allSlugs, allCategories, isSchoolTarget],
  );

  /* ── Proficiency filter (applied on top of region/gradeSpan) ── */
  const profActive = filterProficiency.length === 1 ? filterProficiency[0] : null;
  const profDisplayRows = useMemo(() => {
    if (!profActive) return displayRows;
    return displayRows.filter((r) => {
      if (r.overall == null) return false;
      return profActive === "Proficient" ? r.overall >= 0.7 : r.overall < 0.7;
    });
  }, [displayRows, profActive]);

  /* First column label */
  const firstColLabel =
    viewBy === "school"    ? "School" :
    viewBy === "region"    ? "Region" :
    "Grade Span";

  /* ── Render ────────────────────────────────────────────── */
  return (
    <Fragment>
    <div className="h-full flex flex-col" style={{ backgroundColor: "#F4F6FB", fontFamily: "'Libre Franklin', sans-serif" }}>

      {/* ══ HEADER ═══════════════════════════════════════════ */}
      {currentUser && (
        <div ref={headerRef} className="sticky top-0 z-30 shadow-md">
          <AppHeader
            subtitle="Network Overview"
            basePath={baseUrl}
            userName={currentUser.name}
            userRole={currentUser.role}
            canAdmin={currentUser.role !== "COACH"}
            rubricSets={rubricSets}
            activeRubricSet={activeRubricSet}
            onRubricChange={onRubricChange}
          />
        </div>
      )}

      {/* ══ MAIN ═════════════════════════════════════════════ */}
      <main className="px-3 sm:px-5 py-3 sm:py-4 flex flex-col gap-3 flex-1 min-h-0">

        {/* ── View By + Score Type toggles ─────────────────── */}
        <div
          className="bg-white rounded-md px-3 sm:px-4 py-2 sm:py-2.5 flex flex-wrap gap-2 sm:gap-3 items-center"
          style={{ border: "1px solid #dde3f0", borderLeft: `3px solid ${NAVY}` }}
        >
          {/* View By label + pills */}
          <span
            className="font-bold uppercase tracking-widest shrink-0"
            style={{ color: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: "0.03em" }}
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
                  fontSize: 15,
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
            style={{ color: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: "0.03em" }}
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

          {/* Grade Span filter — hidden when grouping by grade span OR rubric already scopes it */}
          {viewBy !== "gradeSpan" && activeRubricSpans.length === 0 && (
            <FilterMultiSelect
              label="Grade Span"
              values={filterGradeSpan}
              onChange={setFilterGradeSpan}
              options={[...GRADE_SPANS]}
            />
          )}

          {/* Rubric grade-span scope badge */}
          {activeRubricSpans.length > 0 && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border" style={{ color: NAVY, backgroundColor: "rgba(16,52,180,0.07)", borderColor: "rgba(16,52,180,0.25)" }}>
              Showing: {activeRubricSpans.map((s) => s === "ES" ? "Elementary" : s === "MS" ? "Middle" : "High School").join(", ")}
            </span>
          )}

          {/* Proficiency filter */}
          <FilterMultiSelect
            label="Proficiency"
            values={filterProficiency}
            onChange={setFilterProficiency}
            options={["Proficient", "Not Yet"]}
          />

          {/* Clear all */}
          {(filterRegion.length > 0 || filterGradeSpan.length > 0 || filterProficiency.length > 0) && (
            <button
              onClick={() => { setFilterRegion([]); setFilterGradeSpan([]); setFilterProficiency([]); }}
              className="font-semibold underline underline-offset-2"
              style={{ color: NAVY, fontSize: 14 }}
            >
              Clear all
            </button>
          )}

          {/* Divider before right controls */}
          <div style={{ width: 1, height: 24, backgroundColor: "#dde3f0" }} className="hidden sm:block" />

          {/* Most Recent / Quarter Avg / Walkthroughs — hidden for school-target rubrics */}
          {!isSchoolTarget && (
            <div className="ml-auto flex rounded-md overflow-hidden shrink-0" style={{ border: `1.5px solid ${NAVY}`, fontFamily: "'Bebas Neue', sans-serif" }}>
              {(["recent", "average", "walkthroughs"] as ScoreType[]).map((mode, i, arr) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setScoreType(mode)}
                  className="px-4 py-1.5 font-bold uppercase tracking-wider transition-colors"
                  style={{
                    backgroundColor: scoreType === mode ? NAVY : "transparent",
                    color: scoreType === mode ? "white" : NAVY,
                    letterSpacing: "0.02em",
                    fontSize: 15,
                    borderRight: i < arr.length - 1 ? `1px solid ${NAVY}` : undefined,
                  }}
                >
                  {mode === "recent" ? "Most Recent" : mode === "average" ? "Rubric Avg" : "Walkthroughs"}
                </button>
              ))}
            </div>
          )}

          {/* Add School Observation button — NETWORK_ADMIN/NETWORK_LEADER + SCHOOL-target rubric only */}
          {isSchoolTarget && (currentUser?.role === "NETWORK_ADMIN" || currentUser?.role === "NETWORK_LEADER") && (
            <button
              type="button"
              onClick={() => setSchoolObsModalOpen(true)}
              className="ml-auto flex items-center gap-2 px-4 py-1.5 rounded font-bold uppercase tracking-wide text-white transition-opacity hover:opacity-90 shrink-0"
              style={{ backgroundColor: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: "0.04em" }}
            >
              <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> Add School Observation
            </button>
          )}
        </div>

        {/* ── Loading / Error ──────────────────────────────── */}
        {isLoading && (
          <div className="flex-1 flex items-center justify-center py-20">
            <div className="inline-block w-10 h-10 rounded-full border-4 border-blue-200 animate-spin" style={{ borderTopColor: NAVY }} />
          </div>
        )}
        {isError && (
          <div className="py-10 text-center text-red-600 font-semibold">Failed to load network summary.</div>
        )}

        {/* ── Grid ─────────────────────────────────────────── */}
        {data && !isLoading && (
          <div className="flex-1 min-h-0">
          <div className="overflow-auto max-h-full bg-white rounded-md shadow-sm" style={{ border: "1px solid #dde3f0" }}>
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
                        paddingTop: 5, paddingBottom: 5,
                        fontFamily: "'Bebas Neue', sans-serif",
                        fontWeight: 700,
                        fontSize: 18,
                        letterSpacing: "0.02em",
                      }}
                    >
                      <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 2, backgroundColor: YELLOW }} />
                      {firstColLabel}
                    </th>

                    {data.categories.map((cat, catIdx) => (
                      <th
                        key={cat.id}
                        colSpan={cat.domains.length + 1}
                        className="text-center font-bold uppercase tracking-wider text-white"
                        style={{
                          fontFamily: "'Bebas Neue', sans-serif",
                          fontSize: 18,
                          letterSpacing: "0.02em",
                          borderLeft: catIdx === 0 ? "none" : `2px solid ${YELLOW}`,
                          paddingTop: 5, paddingBottom: 5,
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
                        width: 64, minWidth: 64,
                        fontFamily: "'Bebas Neue', sans-serif",
                        fontWeight: 700,
                        fontSize: 18,
                        letterSpacing: "0.02em",
                        borderLeft: `2px solid ${YELLOW}`,
                        backgroundColor: NAVY,
                        paddingTop: 5, paddingBottom: 5,
                      }}
                    >
                      AVG
                    </th>

                    <th
                      rowSpan={2}
                      className="text-center text-white uppercase"
                      style={{
                        width: 90, minWidth: 90,
                        fontFamily: "'Bebas Neue', sans-serif",
                        fontWeight: 700,
                        fontSize: 18,
                        letterSpacing: "0.02em",
                        borderLeft: `2px solid ${YELLOW}`,
                        backgroundColor: NAVY,
                        paddingTop: 5, paddingBottom: 5,
                      }}
                    >
                      Proficient
                    </th>
                  </tr>

                  {/* Domain headers — vertical text */}
                  <tr style={{ backgroundColor: "#ffffff" }}>
                    {data.categories.flatMap((cat, catIdx) => {
                      const isFirstCatDomain = (domain: { id: string }) =>
                        cat.domains[0]?.id === domain.id;
                      return [
                        ...cat.domains.map((domain) => {
                          const hasDesc = !!domain.description;
                          return (
                            <th
                              key={domain.id}
                              style={{
                                width: 68, minWidth: 68, height: 88,
                                color: NAVY,
                                borderLeft: isFirstCatDomain(domain) ? (catIdx === 0 ? "none" : `2px solid ${YELLOW}`) : "1px solid #e8edf8",
                                textAlign: "center",
                                verticalAlign: "top",
                                paddingTop: 6,
                                overflow: "visible",
                                cursor: hasDesc ? "help" : undefined,
                              }}
                              onMouseEnter={hasDesc ? (e) => {
                                setDomainTooltip({ slug: domain.id, x: e.clientX, y: e.clientY + 16, description: domain.description! });
                              } : undefined}
                              onMouseMove={hasDesc ? (e) => {
                                setDomainTooltip((prev) => prev ? { ...prev, x: e.clientX, y: e.clientY + 16 } : null);
                              } : undefined}
                              onMouseLeave={hasDesc ? () => setDomainTooltip(null) : undefined}
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
                                  fontSize: "12px",
                                  fontWeight: 700,
                                  lineHeight: 1.3,
                                }}
                              >
                                {domain.label}
                              </div>
                            </th>
                          );
                        }),
                        /* SUB AVG header for this category */
                        <th
                          key={`subavg-${cat.id}`}
                          style={{
                            width: 62, minWidth: 62, height: 88,
                            backgroundColor: YELLOW,
                            color: NAVY,
                            borderLeft: `3px solid ${YELLOW}`,
                            textAlign: "center",
                            verticalAlign: "top",
                            paddingTop: 6,
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
                              fontSize: "14px",
                              fontWeight: 800,
                              lineHeight: 1.3,
                              textTransform: "uppercase",
                              letterSpacing: "0.04em",
                            }}
                          >
                            Sub Avg
                          </div>
                        </th>,
                      ];
                    })}
                  </tr>

                  {/* Yellow separator */}
                  <tr style={{ height: 3, backgroundColor: YELLOW }}>
                    <td colSpan={allDomains.length + allCategories.length + 3} style={{ padding: 0, height: 3, backgroundColor: YELLOW }} />
                  </tr>

                </thead>
                <tbody>
                  {profDisplayRows.map((row, rowIdx) => {
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
                          className="pl-3 pr-2 py-1 sticky left-0 z-10"
                          style={{ width: 200, backgroundColor: isEven ? "#ffffff" : "#f7f9fd" }}
                        >
                          <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 2, backgroundColor: YELLOW }} />
                          {row.isClickable ? (
                            <button
                              className="font-semibold leading-tight truncate text-left w-full hover:underline"
                              style={{ color: NAVY, fontSize: 15, cursor: "pointer" }}
                              onClick={() => {
                                if (row.schoolId == null) return;
                                const school = data.schools.find((s) => s.id === row.schoolId);
                                onDrillDown(row.schoolId, row.label, school?.gradeSpan, school?.abbreviation ?? undefined);
                              }}
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

                        {/* Per-category: domain cells + SUB AVG cell */}
                        {data.categories.flatMap((cat, catIdx) => [
                          ...cat.domains.map((domain, dIdx) => {
                            const val = row.domainAverages[domain.id] ?? null;
                            const isFirst = dIdx === 0;
                            const borderStyle = isFirst
                              ? { borderLeft: catIdx === 0 ? "none" : `2px solid ${YELLOW}` }
                              : { borderLeft: "1px solid #e8edf8" };
                            return val != null ? (
                              <td
                                key={domain.id}
                                className="text-center py-1.5 text-xl font-bold tabular-nums"
                                style={{ ...borderStyle, width: 68, minWidth: 68, fontFamily: "'Bebas Neue', sans-serif", backgroundColor: "transparent", color: getScoreTextColor(val) }}
                              >
                                {val.toFixed(1)}
                              </td>
                            ) : (
                              <td key={domain.id} className="text-center text-slate-300 py-1.5" style={{ ...borderStyle, width: 68, minWidth: 68, backgroundColor: "transparent" }}>—</td>
                            );
                          }),
                          /* SUB AVG cell — full-cell background coloring */
                          (() => {
                            const sub = row.catSubAvgs[cat.id] ?? null;
                            return sub != null ? (
                              <td
                                key={`subavg-${cat.id}`}
                                className={`text-center font-bold py-1 ${getScoreColor(sub)}`}
                                style={{ borderLeft: `3px solid ${YELLOW}`, width: 62, minWidth: 62, fontFamily: "'Bebas Neue', sans-serif", fontSize: 20 }}
                              >
                                {sub.toFixed(1)}
                              </td>
                            ) : (
                              <td
                                key={`subavg-${cat.id}`}
                                className="text-center text-slate-300 py-1"
                                style={{ borderLeft: `3px solid ${YELLOW}`, width: 62, minWidth: 62, backgroundColor: "#f7f9fd" }}
                              >
                                —
                              </td>
                            );
                          })(),
                        ])}

                        {/* AVG column — full-cell coloring */}
                        {row.overall != null ? (
                          <td
                            className={`text-center text-xl font-bold py-1.5 ${getScoreColor(row.overall)}`}
                            style={{ borderLeft: `2px solid ${YELLOW}`, fontFamily: "'Bebas Neue', sans-serif" }}
                          >
                            {row.overall.toFixed(1)}
                          </td>
                        ) : (
                          <td className="text-center text-slate-300 py-1.5" style={{ borderLeft: `2px solid ${YELLOW}` }}>—</td>
                        )}

                        {/* PROFICIENT column */}
                        <td className="text-center py-1 px-1" style={{ borderLeft: `2px solid ${YELLOW}` }}>
                          {row.overall != null ? (
                            <span
                              className="inline-block px-2 py-0.5 rounded text-xs font-bold"
                              style={{
                                backgroundColor: row.overall >= 0.7 ? "#dcfce7" : "#fee2e2",
                                color: row.overall >= 0.7 ? "#15803d" : "#b91c1c",
                              }}
                            >
                              {row.overall >= 0.7 ? "Proficient" : "Not Yet"}
                            </span>
                          ) : (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}

                  {profDisplayRows.length === 0 && (
                    <tr>
                      <td colSpan={allDomains.length + data.categories.length + 3} className="text-center py-12 text-slate-400 text-sm">
                        {profActive
                          ? `No schools match the "${profActive}" filter.`
                          : "No data available for this quarter."}
                      </td>
                    </tr>
                  )}

                  {/* ── DOMAIN AVERAGE FOOTER ─────────────────── */}
                  {profDisplayRows.length > 0 && (
                    <tr
                      className="sticky bottom-0 z-20 font-semibold"
                      style={{ backgroundColor: NAVY, boxShadow: `0 -2px 0 0 ${YELLOW}` }}
                    >
                      <td
                        className="pl-3 pr-2 py-1 sticky left-0 z-30 uppercase tracking-wide"
                        style={{
                          color: YELLOW,
                          backgroundColor: NAVY,
                          fontFamily: "'Bebas Neue', sans-serif",
                          fontWeight: 700,
                          fontSize: 20,
                          letterSpacing: "0.02em",
                        }}
                      >
                        <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 2, backgroundColor: YELLOW }} />
                        Domain Avg
                      </td>

                      {allCategories.flatMap((cat, catIdx) => [
                        ...cat.domains.map((domain, dIdx) => {
                          const vals = profDisplayRows
                            .map((r) => r.domainAverages[domain.id] ?? null)
                            .filter((v): v is number => v !== null);
                          const domAvg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
                          return (
                            <td
                              key={domain.id}
                              className="text-center font-bold py-1.5"
                              style={{
                                ...(dIdx === 0 ? { borderLeft: catIdx === 0 ? "none" : `2px solid ${YELLOW}` } : { borderLeft: "1px solid rgba(255,181,0,0.25)" }),
                                backgroundColor: "white",
                                color: domAvg !== null ? getScoreTextColor(domAvg) : "#94a3b8",
                                fontFamily: "'Bebas Neue', sans-serif",
                                fontSize: 20,
                              }}
                            >
                              {domAvg !== null ? domAvg.toFixed(1) : "—"}
                            </td>
                          );
                        }),
                        (() => {
                          const catVals = profDisplayRows
                            .map((r) => r.catSubAvgs[cat.id] ?? null)
                            .filter((v): v is number => v !== null);
                          const catAvg = catVals.length ? catVals.reduce((s, v) => s + v, 0) / catVals.length : null;
                          return (
                            <td
                              key={`subavg-${cat.id}`}
                              className={`text-center font-bold py-1.5 ${catAvg !== null ? getScoreColor(catAvg) : "text-slate-400"}`}
                              style={{ borderLeft: `3px solid ${YELLOW}`, width: 62, minWidth: 62, fontFamily: "'Bebas Neue', sans-serif", fontSize: 20 }}
                            >
                              {catAvg !== null ? catAvg.toFixed(1) : "—"}
                            </td>
                          );
                        })(),
                      ])}

                      {/* Overall avg */}
                      {(() => {
                        const overallVals = profDisplayRows
                          .map((r) => r.overall)
                          .filter((v): v is number => v !== null);
                        const overallAvg = overallVals.length
                          ? overallVals.reduce((s, v) => s + v, 0) / overallVals.length
                          : null;
                        return overallAvg !== null ? (
                          <td
                            className={`text-center text-xl font-bold py-2 ${getScoreColor(overallAvg)}`}
                            style={{ borderLeft: `2px solid ${YELLOW}`, fontFamily: "'Bebas Neue', sans-serif" }}
                          >
                            {overallAvg.toFixed(1)}
                          </td>
                        ) : (
                          <td className="text-center text-slate-400 py-2" style={{ borderLeft: `2px solid ${YELLOW}` }}>—</td>
                        );
                      })()}

                      {/* Blank proficient cell */}
                      <td style={{ borderLeft: `2px solid ${YELLOW}` }} />
                    </tr>
                  )}
                </tbody>
              </table>
          </div>
          </div>
        )}
      </main>

      <footer className="text-center pt-1 pb-4" style={{ color: "#94a3b8", fontSize: 12, fontFamily: "'Libre Franklin', sans-serif" }}>
        &copy; {new Date().getFullYear()} Uncommon Schools, Inc. All rights reserved. | This site is in beta and may have bugs. Share feedback and ideas by completing <a href="https://docs.google.com/forms/d/e/1FAIpQLScGsGBwHNyxAv1jcKYR5Q85gHbIZpUojwVW9PxrgJm7zv20jw/viewform?usp=header" target="_blank" rel="noopener noreferrer" style={{ color: "#64748b", fontWeight: 600 }}>this form</a>.
      </footer>

    </div>

    {/* ── School Observation Modal ──────────────────────────────── */}
    {data && (
      <SchoolObservationModal
        open={schoolObsModalOpen}
        onOpenChange={setSchoolObsModalOpen}
        rubricSetId={data.rubricSet.id}
        rubricSetName={data.rubricSet.name}
        categories={data.categories}
        onSaved={() => {
          setSchoolObsModalOpen(false);
          queryClient.invalidateQueries({ queryKey: ["district", activeRubricSet, scoreType] });
        }}
      />
    )}

    {/* ── Domain tooltip overlay ─────────────────────────────── */}
    {domainTooltip && domainTooltip.description && (() => {
      const TW = 280;
      const PAD = 10;
      const vpW = window.innerWidth;
      const mouseX = domainTooltip.x;
      const idealLeft = mouseX - TW / 2;
      const clampedLeft = Math.max(PAD, Math.min(vpW - TW - PAD, idealLeft));
      const caretX = Math.max(7, Math.min(TW - 7, mouseX - clampedLeft));
      return (
        <div style={{ position: "fixed", top: domainTooltip.y, left: clampedLeft, width: TW, zIndex: 9999, pointerEvents: "none" }}>
          {/* Arrow pinned to mouse X — absolutely positioned so box margin matches exactly */}
          <div style={{
            position: "absolute", top: 0, left: caretX, transform: "translateX(-50%)",
            width: 0, height: 0,
            borderLeft: "7px solid transparent",
            borderRight: "7px solid transparent",
            borderBottom: `7px solid ${NAVY}`,
          }} />
          <div style={{
            marginTop: 6,
            backgroundColor: NAVY, color: "white", borderRadius: 8,
            padding: "10px 14px", fontSize: 13, lineHeight: 1.5,
            fontFamily: "'Libre Franklin', sans-serif",
            boxShadow: "0 4px 16px rgba(0,0,0,0.25)", textAlign: "left",
          }}>
            {domainTooltip.description}
          </div>
        </div>
      );
    })()}
    </Fragment>
  );
}
