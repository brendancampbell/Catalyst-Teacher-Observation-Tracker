import { useState, useMemo, useRef, useEffect } from "react";
import { Plus } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEPARTMENTS,
  GRADE_LEVELS,
  getMostRecentObservation,
  getTeacherAverage,
  getDomainAverage,
  type Score,
  type Teacher,
  type Observation,
  type DomainEntry,
} from "@/data/dummy";
import { fetchDashboard, createObservation, updateObservation } from "@/lib/api";
import type { CategoryEntry } from "@/lib/api";
import { ScoreCell, getScoreColor } from "@/components/ScoreCell";
import { NewObservationModal } from "@/components/NewObservationModal";
import { DrillDownModal } from "@/components/DrillDownModal";
import { TeacherProfile } from "@/components/TeacherProfile";

type ViewMode = "recent" | "quarterAvg";
type ViewBy   = "teacher" | "department" | "grade";

/* ── Per-teacher domain helpers ────────────────────── */

function getQuarterDomainScore(teacher: Teacher, domainId: string): number {
  const vals = teacher.observations
    .map((o) => o.scores[domainId] as Score | undefined)
    .filter((s): s is Score => s !== undefined);
  return vals.length ? vals.reduce((sum, s) => sum + s, 0) / vals.length : 0;
}

function getQuarterTeacherAvg(teacher: Teacher, allDomains: DomainEntry[]): number {
  const perDomain = allDomains.map((d) => getQuarterDomainScore(teacher, d.id));
  return perDomain.reduce((s, v) => s + v, 0) / perDomain.length;
}

function getQuarterDomainAvg(domainId: string, teachers: Teacher[]): number {
  const vals = teachers.map((t) => getQuarterDomainScore(t, domainId));
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

/* ── Group (rollup) helpers ─────────────────────────── */

interface GroupRow {
  key: string;
  label: string;
  subLabel: string;
  teachers: Teacher[];
}

function buildGroups(filteredTeachers: Teacher[], viewBy: ViewBy): GroupRow[] {
  const ORDER = viewBy === "department" ? [...DEPARTMENTS] : [...GRADE_LEVELS];
  const map = new Map<string, Teacher[]>();
  for (const t of filteredTeachers) {
    const k = viewBy === "department" ? t.department : t.gradeLevel;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(t);
  }
  return ORDER
    .filter((k) => map.has(k))
    .map((k) => ({
      key: k,
      label: k,
      subLabel: `${map.get(k)!.length} teacher${map.get(k)!.length === 1 ? "" : "s"}`,
      teachers: map.get(k)!,
    }));
}

function getGroupDomainScore(groupTeachers: Teacher[], domainId: string, viewMode: ViewMode): number {
  const scores = groupTeachers
    .map((t) =>
      viewMode === "recent"
        ? ((getMostRecentObservation(t).scores[domainId] as number) ?? 0)
        : getQuarterDomainScore(t, domainId),
    )
    .filter((s) => s > 0);
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
}

function getGroupOverallAvg(groupTeachers: Teacher[], allDomains: DomainEntry[], viewMode: ViewMode): number {
  const perDomain = allDomains.map((d) => getGroupDomainScore(groupTeachers, d.id, viewMode));
  const nonZero = perDomain.filter((s) => s > 0);
  return nonZero.length ? nonZero.reduce((a, b) => a + b, 0) / nonZero.length : 0;
}

/* ── Constants ──────────────────────────────────────── */

const NAVY   = "#1034B4";
const YELLOW = "#FFB500";

interface DrillDownTarget {
  teacherId: string;
  domainId: string;
  domainLabel: string;
}

/* ══ Dashboard component ════════════════════════════════════════════ */

export default function Dashboard() {
  const currentUser = { name: "Principal Rivera", school: "Lincoln Elementary" };
  const queryClient = useQueryClient();

  /* ── API data ──────────────────────────────────────── */
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard", "Q1"],
    queryFn: () => fetchDashboard("Q1"),
    staleTime: 30_000,
  });

  const teachers: Teacher[]       = data?.teachers   ?? [];
  const categories: CategoryEntry[] = data?.categories ?? [];
  const allDomains: DomainEntry[] = categories.flatMap((c) => c.domains);
  const quarterId: number         = data?.quarter.id  ?? 0;

  /* ── Filter state ──────────────────────────────────── */
  const [search, setSearch] = useState("");
  const [dept, setDept]     = useState<string[]>([]);
  const [grade, setGrade]   = useState<string[]>([]);

  /* ── View toggles ──────────────────────────────────── */
  const [viewMode, setViewMode] = useState<ViewMode>("recent");
  const [viewBy,   setViewBy]   = useState<ViewBy>("teacher");

  /* ── Teacher profile ───────────────────────────────── */
  const [teacherProfileId, setTeacherProfileId] = useState<string | null>(null);

  /* ── Modal state ───────────────────────────────────── */
  const [newObsOpen, setNewObsOpen] = useState(false);
  const [drillDown, setDrillDown]   = useState<DrillDownTarget | null>(null);
  const [saving, setSaving]         = useState(false);

  /* ── Filtered teacher list ─────────────────────────── */
  const filtered = useMemo(() => {
    return teachers.filter((t) => {
      if (viewBy === "teacher" && search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (dept.length  && !dept.includes(t.department)) return false;
      if (grade.length && !grade.includes(t.gradeLevel)) return false;
      return true;
    });
  }, [teachers, search, dept, grade, viewBy]);

  /* ── Group rows (for rollup views) ─────────────────── */
  const groupRows = useMemo(
    () => (viewBy !== "teacher" ? buildGroups(filtered, viewBy) : []),
    [filtered, viewBy],
  );

  /* ── Stats — teacher view ──────────────────────────── */
  const teacherAvgFn   = (t: Teacher) =>
    viewMode === "recent" ? getTeacherAverage(t) : getQuarterTeacherAvg(t, allDomains);

  /* ── Stats — rollup view ───────────────────────────── */
  const groupAvgs = useMemo(
    () => groupRows.map((g) => getGroupOverallAvg(g.teachers, allDomains, viewMode)),
    [groupRows, allDomains, viewMode],
  );

  const statCount        = viewBy === "teacher" ? filtered.length : groupRows.length;
  const statAvg          = viewBy === "teacher"
    ? (filtered.length ? filtered.reduce((s, t) => s + teacherAvgFn(t), 0) / filtered.length : 0)
    : (groupAvgs.length  ? groupAvgs.reduce((a, b) => a + b, 0) / groupAvgs.length : 0);
  const statProficient   = viewBy === "teacher"
    ? filtered.filter((t) => teacherAvgFn(t) >= 3).length
    : groupAvgs.filter((a) => a >= 3).length;
  const statNeedsSupport = viewBy === "teacher"
    ? filtered.filter((t) => teacherAvgFn(t) < 2).length
    : groupAvgs.filter((a) => a < 2).length;

  const hasFilters = !!(search || dept.length || grade.length);

  /* ── Handlers ──────────────────────────────────────── */
  async function handleNewObservation(
    teacherId: string,
    date: string,
    scores: Record<string, Score>,
    strengths: string,
    growthAreas: string,
  ) {
    if (!quarterId) return;
    setSaving(true);
    try {
      await createObservation({
        teacherId,
        quarterId,
        date,
        scores,
        strengths: strengths || undefined,
        growthAreas: growthAreas || undefined,
        observer: currentUser.name,
      });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (err) {
      console.error("Failed to save observation:", err);
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateObs(teacherId: string, updated: Observation) {
    setSaving(true);
    try {
      await updateObservation(updated.id, {
        date: updated.date,
        strengths: updated.strengths,
        growthAreas: updated.growthAreas,
        observer: updated.observer,
        scores: updated.scores as Record<string, Score>,
      });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (err) {
      console.error("Failed to update observation:", err);
    } finally {
      setSaving(false);
    }
  }

  function openDrillDown(teacher: Teacher, domainId: string, domainLabel: string) {
    setDrillDown({ teacherId: teacher.id, domainId, domainLabel });
  }

  const profileTeacher = teacherProfileId
    ? (teachers.find((t) => t.id === teacherProfileId) ?? null)
    : null;

  /* ── Label helpers ─────────────────────────────────── */
  const firstColLabel = viewBy === "teacher" ? "Teacher / Dept"
    : viewBy === "department" ? "Department"
    : "Grade Level";

  const rowCountLabel = viewBy === "teacher" ? "Teachers Shown"
    : viewBy === "department" ? "Departments"
    : "Grade Levels";

  /* ── Loading / Error states ─────────────────────────── */
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#F4F6FB" }}>
        <div className="text-center">
          <div className="inline-block w-12 h-12 rounded-full border-4 border-blue-200 animate-spin" style={{ borderTopColor: NAVY }} />
          <p className="mt-4 font-semibold" style={{ color: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: "0.04em" }}>
            Loading Dashboard…
          </p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#F4F6FB" }}>
        <div className="text-center text-red-600 space-y-2">
          <p className="text-lg font-bold">Failed to load dashboard data.</p>
          <p className="text-sm text-slate-500">Check that the API server is running and try refreshing.</p>
        </div>
      </div>
    );
  }

  return (
    <>
    {profileTeacher ? (
      <TeacherProfile
        teacher={profileTeacher}
        onBack={() => setTeacherProfileId(null)}
        currentUser={currentUser}
        onNewObs={() => setNewObsOpen(true)}
      />
    ) : (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#F4F6FB", fontFamily: "'Libre Franklin', sans-serif" }}>

      {/* ══ HEADER ═════════════════════════════════════════════ */}
      <div style={{ height: 5, backgroundColor: YELLOW }} />

      <header style={{ backgroundColor: NAVY }} className="sticky top-0 z-30 shrink-0 shadow-md">
        <div className="px-3 sm:px-5 py-3 sm:py-4 flex items-center justify-between gap-2">

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
              <p className="text-blue-200 font-medium truncate" style={{ fontSize: 15 }}>{currentUser.school}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              onClick={() => setNewObsOpen(true)}
              className="flex items-center gap-1.5 font-bold rounded-md px-3 sm:px-4 py-2 transition-opacity hover:opacity-90 shadow-sm"
              style={{
                backgroundColor: YELLOW,
                color: NAVY,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 15,
                letterSpacing: "0.02em",
              }}
            >
              <Plus size={16} strokeWidth={3} />
              <span className="hidden sm:inline">Add Observation</span>
            </button>

            <a
              href={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/admin`}
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

            <div
              className="flex items-center gap-2 rounded px-2 sm:px-3 py-1.5"
              style={{ backgroundColor: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)" }}
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                style={{ backgroundColor: YELLOW, color: NAVY }}
              >
                PR
              </div>
              <span className="text-white font-medium hidden sm:block" style={{ fontSize: 15 }}>{currentUser.name}</span>
              <span
                className="font-semibold rounded-full px-2.5 py-0.5 hidden md:block"
                style={{ backgroundColor: YELLOW, color: NAVY, fontSize: 13 }}
              >
                PRINCIPAL
              </span>
            </div>
          </div>
        </div>
        <div style={{ height: 3, backgroundColor: YELLOW }} />
      </header>

      {/* ══ MAIN ════════════════════════════════════════════════ */}
      <main className="px-3 sm:px-5 py-3 sm:py-4 flex flex-col gap-3 flex-1 min-h-0">

        {/* ── Stats ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-2.5">
          {[
            { label: rowCountLabel,          value: statCount,                                       pct: null,                                                                      colorScore: null as number | null },
            { label: "Average Score",         value: statCount ? statAvg.toFixed(1) : "—",           pct: null,                                                                      colorScore: statCount ? statAvg : null },
            { label: "Proficient+ (≥ 3)",    value: statProficient,    pct: statCount ? Math.round(statProficient    / statCount * 100) : null, colorScore: null as number | null },
            { label: "Need Support (< 2)",   value: statNeedsSupport,  pct: statCount ? Math.round(statNeedsSupport  / statCount * 100) : null, colorScore: null as number | null },
          ].map(({ label, value, pct, colorScore }) => (
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
                  <p
                    className="font-bold mt-1 leading-none"
                    style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY, fontWeight: 800, fontSize: 36 }}
                  >
                    {value}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* ── Filters + View toggles ─────────────────────────── */}
        <div
          className="bg-white rounded-md px-3 sm:px-4 py-2 sm:py-2.5 flex flex-wrap gap-2 sm:gap-3 items-center"
          style={{ border: "1px solid #dde3f0", borderLeft: `3px solid ${NAVY}` }}
        >
          {/* "View By" label + pill buttons */}
          <span
            className="font-bold uppercase tracking-widest shrink-0"
            style={{ color: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, letterSpacing: "0.03em" }}
          >
            View By
          </span>
          <div className="flex rounded-md overflow-hidden shrink-0" style={{ border: `1.5px solid ${NAVY}`, fontFamily: "'Bebas Neue', sans-serif" }}>
            {(["teacher", "department", "grade"] as ViewBy[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => { setViewBy(mode); if (mode !== "teacher") setSearch(""); }}
                className="px-3 sm:px-4 py-1.5 font-bold uppercase tracking-wider transition-colors"
                style={{
                  backgroundColor: viewBy === mode ? NAVY : "transparent",
                  color: viewBy === mode ? "white" : NAVY,
                  letterSpacing: "0.02em",
                  fontSize: 13,
                  borderRight: mode !== "grade" ? `1px solid ${NAVY}` : undefined,
                }}
              >
                {mode === "teacher" ? "Teacher" : mode === "department" ? "Department" : "Grade"}
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

          {/* Search — only shown in teacher view */}
          {viewBy === "teacher" && (
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
              </svg>
              <input
                type="search"
                placeholder="Search teacher…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 rounded w-44 focus:outline-none"
                style={{ border: "1px solid #dde3f0", backgroundColor: "#F4F6FB", fontSize: 14 }}
              />
            </div>
          )}

          {/* Department filter — hidden when grouped by dept */}
          {viewBy !== "department" && (
            <FilterMultiSelect label="Department" values={dept}  onChange={setDept}  options={[...DEPARTMENTS]} />
          )}

          {/* Grade filter — hidden when grouped by grade */}
          {viewBy !== "grade" && (
            <FilterMultiSelect label="Grade"      values={grade} onChange={setGrade} options={[...GRADE_LEVELS]} />
          )}

          {hasFilters && (
            <button
              onClick={() => { setSearch(""); setDept([]); setGrade([]); }}
              className="font-semibold underline underline-offset-2"
              style={{ color: NAVY, fontSize: 14 }}
            >
              Clear all
            </button>
          )}

          {/* Most Recent / Quarter Avg — right-aligned */}
          <div className="ml-auto flex rounded-md overflow-hidden shrink-0" style={{ border: `1.5px solid ${NAVY}`, fontFamily: "'Bebas Neue', sans-serif" }}>
            {(["recent", "quarterAvg"] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className="px-4 py-1.5 font-bold uppercase tracking-wider transition-colors"
                style={{
                  backgroundColor: viewMode === mode ? NAVY : "transparent",
                  color: viewMode === mode ? "white" : NAVY,
                  letterSpacing: "0.02em",
                  fontSize: 13,
                }}
              >
                {mode === "recent" ? "Most Recent" : "Quarter Avg"}
              </button>
            ))}
          </div>
        </div>

        {/* ── Table ─────────────────────────────────────────── */}
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
                      width: 180, minWidth: 180,
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

                  {categories.map((cat) => (
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
                    const isFirstInCat = categories.some((c) => c.domains[0]?.id === domain.id);
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

                {/* ── TEACHER VIEW ─────────────────────────── */}
                {viewBy === "teacher" && (
                  filtered.length === 0 ? (
                    <tr>
                      <td colSpan={allDomains.length + 2} className="text-center py-12 text-slate-400 text-sm">
                        No teachers match the current filters.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((teacher, rowIdx) => {
                      const recent = getMostRecentObservation(teacher);
                      const avg    = viewMode === "recent" ? getTeacherAverage(teacher) : getQuarterTeacherAvg(teacher, allDomains);
                      const isEven = rowIdx % 2 === 0;
                      return (
                        <tr
                          key={teacher.id}
                          className="border-b transition-colors"
                          style={{ borderColor: "#e8edf8", backgroundColor: isEven ? "#ffffff" : "#f7f9fd" }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#eef2fc")}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = isEven ? "#ffffff" : "#f7f9fd")}
                        >
                          <td
                            className="pl-3 pr-2 py-1.5 sticky left-0 z-10"
                            style={{ width: 180, backgroundColor: isEven ? "#ffffff" : "#f7f9fd", borderRight: `2px solid ${YELLOW}` }}
                          >
                            <button
                              className="font-semibold leading-tight truncate text-left w-full hover:underline"
                              style={{ color: NAVY, fontSize: 15, cursor: "pointer" }}
                              onClick={() => setTeacherProfileId(teacher.id)}
                            >
                              {teacher.name}
                            </button>
                            <p className="text-slate-400 mt-px" style={{ fontSize: 12 }}>
                              {teacher.department} · {teacher.gradeLevel}
                            </p>
                          </td>

                          {allDomains.map((domain) => {
                            const score = viewMode === "recent"
                              ? (recent.scores[domain.id] as Score | undefined)
                              : getQuarterDomainScore(teacher, domain.id);
                            const isFirstInCat = categories.some((c) => c.domains[0]?.id === domain.id);
                            return score !== undefined && score !== 0 ? (
                              <ScoreCell
                                key={domain.id}
                                score={score}
                                className="py-1.5"
                                style={isFirstInCat ? { borderLeft: `2px solid ${YELLOW}` } : { borderLeft: "1px solid #e8edf8" }}
                                onClick={() => openDrillDown(teacher, domain.id, domain.label)}
                              />
                            ) : (
                              <td key={domain.id} className="text-center text-slate-300" style={categories.some((c) => c.domains[0]?.id === domain.id) ? { borderLeft: `2px solid ${YELLOW}` } : { borderLeft: "1px solid #e8edf8" }}>—</td>
                            );
                          })}

                          <td
                            className={`text-center font-bold py-1.5 ${getScoreColor(avg)}`}
                            style={{ borderLeft: `2px solid ${YELLOW}` }}
                          >
                            {avg.toFixed(1)}
                          </td>
                        </tr>
                      );
                    })
                  )
                )}

                {/* ── DEPARTMENT / GRADE ROLLUP VIEW ───────── */}
                {viewBy !== "teacher" && (
                  groupRows.length === 0 ? (
                    <tr>
                      <td colSpan={allDomains.length + 2} className="text-center py-12 text-slate-400 text-sm">
                        No {viewBy === "department" ? "departments" : "grade levels"} match the current filters.
                      </td>
                    </tr>
                  ) : (
                    groupRows.map((group, rowIdx) => {
                      const groupAvg = getGroupOverallAvg(group.teachers, allDomains, viewMode);
                      const isEven   = rowIdx % 2 === 0;
                      return (
                        <tr
                          key={group.key}
                          className="border-b transition-colors"
                          style={{ borderColor: "#e8edf8", backgroundColor: isEven ? "#ffffff" : "#f7f9fd" }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#eef2fc")}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = isEven ? "#ffffff" : "#f7f9fd")}
                        >
                          {/* Group label cell */}
                          <td
                            className="pl-3 pr-2 py-2 sticky left-0 z-10"
                            style={{ width: 180, backgroundColor: isEven ? "#ffffff" : "#f7f9fd", borderRight: `2px solid ${YELLOW}` }}
                          >
                            <p className="font-bold leading-tight truncate" style={{ color: NAVY, fontSize: 15 }}>
                              {group.label}
                            </p>
                            <p className="mt-px" style={{ color: "#94a3b8", fontSize: 12 }}>
                              {group.subLabel}
                            </p>
                          </td>

                          {/* Averaged domain score cells */}
                          {allDomains.map((domain) => {
                            const score        = getGroupDomainScore(group.teachers, domain.id, viewMode);
                            const isFirstInCat = categories.some((c) => c.domains[0]?.id === domain.id);
                            return score > 0 ? (
                              <td
                                key={domain.id}
                                className={`text-center font-bold py-2 ${getScoreColor(score)}`}
                                style={isFirstInCat ? { borderLeft: `2px solid ${YELLOW}` } : { borderLeft: "1px solid #e8edf8" }}
                              >
                                {score.toFixed(1)}
                              </td>
                            ) : (
                              <td key={domain.id} className="text-center text-slate-300" style={isFirstInCat ? { borderLeft: `2px solid ${YELLOW}` } : { borderLeft: "1px solid #e8edf8" }}>—</td>
                            );
                          })}

                          {/* Group overall avg */}
                          <td
                            className={`text-center font-bold py-2 ${getScoreColor(groupAvg)}`}
                            style={{ borderLeft: `2px solid ${YELLOW}` }}
                          >
                            {groupAvg.toFixed(1)}
                          </td>
                        </tr>
                      );
                    })
                  )
                )}

                {/* ── DOMAIN AVERAGE FOOTER ─────────────────── */}
                {((viewBy === "teacher" && filtered.length > 0) || (viewBy !== "teacher" && groupRows.length > 0)) && (
                  <tr
                    className="sticky bottom-0 z-20 font-semibold"
                    style={{ backgroundColor: NAVY, borderTop: `3px solid ${YELLOW}` }}
                  >
                    <td
                      className="pl-3 pr-2 py-2 sticky left-0 z-30 uppercase tracking-wide"
                      style={{
                        color: YELLOW,
                        backgroundColor: NAVY,
                        borderRight: `2px solid ${YELLOW}`,
                        fontFamily: "'Bebas Neue', sans-serif",
                        fontWeight: 700,
                        fontSize: 16,
                        letterSpacing: "0.02em",
                      }}
                    >
                      Domain Avg
                    </td>
                    {allDomains.map((domain) => {
                      const avg = viewBy === "teacher"
                        ? (viewMode === "recent"
                            ? getDomainAverage(domain.id, filtered)
                            : getQuarterDomainAvg(domain.id, filtered))
                        : (groupRows.reduce((sum, g) => sum + getGroupDomainScore(g.teachers, domain.id, viewMode), 0) / groupRows.length);
                      const isFirstInCat = categories.some((c) => c.domains[0]?.id === domain.id);
                      return (
                        <td
                          key={domain.id}
                          className={`text-center font-bold py-1.5 ${getScoreColor(avg)}`}
                          style={isFirstInCat ? { borderLeft: `2px solid ${YELLOW}` } : { borderLeft: "1px solid rgba(255,181,0,0.25)" }}
                        >
                          {avg.toFixed(1)}
                        </td>
                      );
                    })}
                    <td
                      className={`text-center font-bold py-1.5 ${getScoreColor(statAvg)}`}
                      style={{ borderLeft: `2px solid ${YELLOW}` }}
                    >
                      {statAvg.toFixed(1)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </main>

      <footer className="text-center py-4" style={{ borderTop: "1px solid #dde3f0", color: "#94a3b8", fontSize: 12, fontFamily: "'Libre Franklin', sans-serif" }}>
        &copy; 2026 Uncommon Schools, Inc. All rights reserved.
      </footer>

    </div>
    )}

      {/* ══ MODALS ════════════════════════════════════════════ */}
      <NewObservationModal
        teachers={teachers}
        categories={categories}
        allDomains={allDomains}
        open={newObsOpen}
        onOpenChange={setNewObsOpen}
        onSubmit={handleNewObservation}
        saving={saving}
      />

      <DrillDownModal
        teacher={drillDown ? (teachers.find((t) => t.id === drillDown.teacherId) ?? null) : null}
        domainId={drillDown?.domainId ?? null}
        domainLabel={drillDown?.domainLabel ?? null}
        open={drillDown !== null}
        onOpenChange={(open) => { if (!open) setDrillDown(null); }}
        onUpdateObs={handleUpdateObs}
        onTeacherClick={() => {
          if (drillDown) {
            setTeacherProfileId(drillDown.teacherId);
            setDrillDown(null);
          }
        }}
      />
    </>
  );
}

/* ── Filter multiselect ─────────────────────────────── */
function FilterMultiSelect({ label, values, onChange, options }: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  options: string[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = values.length > 0;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded font-semibold text-sm transition-colors"
        style={{
          border: `1.5px solid ${active ? NAVY : "#dde3f0"}`,
          backgroundColor: active ? NAVY : "white",
          color: active ? "white" : "#334155",
          fontFamily: "'Libre Franklin', sans-serif",
        }}
      >
        {label}
        {active && (
          <span
            className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold"
            style={{ backgroundColor: YELLOW, color: NAVY }}
          >
            {values.length}
          </span>
        )}
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 bg-white rounded-md shadow-lg z-50 py-1 min-w-[160px]"
          style={{ border: "1px solid #dde3f0" }}
        >
          {options.map((opt) => {
            const checked = values.includes(opt);
            return (
              <label
                key={opt}
                className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-slate-50 text-sm font-medium text-slate-700"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onChange(checked ? values.filter((v) => v !== opt) : [...values, opt])}
                  className="w-4 h-4 rounded accent-blue-700"
                />
                {opt}
              </label>
            );
          })}
          {values.length > 0 && (
            <div className="border-t border-slate-100 mt-1 pt-1 px-3 pb-1">
              <button
                className="text-xs font-semibold underline underline-offset-1"
                style={{ color: NAVY }}
                onClick={(e) => { e.stopPropagation(); onChange([]); }}
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
