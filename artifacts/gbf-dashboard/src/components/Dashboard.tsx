import { Fragment, useState, useMemo, useEffect, useRef } from "react";
import { useViewportHeight } from "@/hooks/use-viewport-height";
import { FilterMultiSelect } from "@/components/FilterMultiSelect";
import AppHeader from "@/components/AppHeader";
import { useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  SUBJECTS,
  GRADE_LEVELS,
  type Score,
  type Teacher,
  type Observation,
  type DomainEntry,
} from "@/data/dummy";
import { fetchDashboard, fetchRubricSets, createObservation, updateObservation } from "@/lib/api";
import type { CategoryEntry, RubricSetRow } from "@/lib/api";
import { useUser } from "@/context/UserContext";
import { ScoreCell, getScoreColor, getScoreTextColor } from "@/components/ScoreCell";
import { NewObservationModal } from "@/components/NewObservationModal";
import { DrillDownModal } from "@/components/DrillDownModal";
import { TeacherProfile } from "@/components/TeacherProfile";
import DistrictDashboard from "@/components/DistrictDashboard";

type ViewMode = "recent" | "periodAvg" | "walkthroughs";
type ViewBy   = "teacher" | "subject" | "grade";

/* ── Per-teacher domain helpers ────────────────────── */

function avg(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/* Most-recent score for a specific domain — iterates observations newest→oldest,
   returns the first observation that actually scored this domain. */
function getMostRecentDomainScore(teacher: Teacher, domainId: string): number | null {
  const sorted = [...teacher.observations].sort((a, b) => b.date.localeCompare(a.date));
  for (const obs of sorted) {
    const score = obs.scores[domainId];
    if (score !== undefined) return score as number;
  }
  return null;
}

/* Period (quarter) average for a specific domain across all observations. */
function getQuarterDomainScore(teacher: Teacher, domainId: string): number | null {
  const vals = teacher.observations
    .map((o) => o.scores[domainId] as Score | undefined)
    .filter((s): s is Score => s !== undefined);
  return vals.length ? avg(vals as number[]) : null;
}

/* Category sub-average for a teacher: avg of domain scores within that category. */
function getCategoryAvg(teacher: Teacher, catDomains: DomainEntry[], viewMode: ViewMode): number | null {
  const domainScores = catDomains
    .map((d) =>
      viewMode === "periodAvg"
        ? getQuarterDomainScore(teacher, d.id)
        : getMostRecentDomainScore(teacher, d.id),
    )
    .filter((s): s is number => s !== null);
  return domainScores.length ? avg(domainScores) : null;
}

/* Overall teacher average = average of category sub-averages. */
function getTeacherOverallAvg(teacher: Teacher, categories: CategoryEntry[], viewMode: ViewMode): number | null {
  const catAvgs = categories
    .map((c) => getCategoryAvg(teacher, c.domains, viewMode))
    .filter((s): s is number => s !== null);
  return catAvgs.length ? avg(catAvgs) : null;
}

/* Domain-level avg across multiple teachers (for footer and group cells). */
function getQuarterDomainAvg(domainId: string, teachers: Teacher[]): number | null {
  const vals = teachers
    .map((t) => getQuarterDomainScore(t, domainId))
    .filter((s): s is number => s !== null);
  return vals.length ? avg(vals) : null;
}

/* ── Group (rollup) helpers ─────────────────────────── */

interface GroupRow {
  key: string;
  label: string;
  subLabel: string;
  teachers: Teacher[];
}

function buildGroups(filteredTeachers: Teacher[], viewBy: ViewBy): GroupRow[] {
  const ORDER = viewBy === "subject" ? [...SUBJECTS] : [...GRADE_LEVELS];
  const map = new Map<string, Teacher[]>();
  for (const t of filteredTeachers) {
    if (viewBy === "subject") {
      const k = t.subject;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(t);
    } else {
      for (const g of t.gradeLevel) {
        if (!map.has(g)) map.set(g, []);
        map.get(g)!.push(t);
      }
    }
  }
  return ORDER
    .filter((k) => map.has(k))
    .map((k) => ({
      key: k,
      label: viewBy === "grade" ? `Grade ${k}` : k,
      subLabel: `${map.get(k)!.length} teacher${map.get(k)!.length === 1 ? "" : "s"}`,
      teachers: map.get(k)!,
    }));
}

function getGroupDomainScore(groupTeachers: Teacher[], domainId: string, viewMode: ViewMode): number | null {
  const scores = groupTeachers
    .map((t) =>
      viewMode === "periodAvg"
        ? getQuarterDomainScore(t, domainId)
        : getMostRecentDomainScore(t, domainId),
    )
    .filter((s): s is number => s !== null);
  return scores.length ? avg(scores) : null;
}

/* Group category sub-average = avg of per-teacher category avgs within group. */
function getGroupCategoryAvg(groupTeachers: Teacher[], catDomains: DomainEntry[], viewMode: ViewMode): number | null {
  const vals = groupTeachers
    .map((t) => getCategoryAvg(t, catDomains, viewMode))
    .filter((s): s is number => s !== null);
  return vals.length ? avg(vals) : null;
}

/* Group overall avg = avg of group category sub-avgs. */
function getGroupOverallAvg(groupTeachers: Teacher[], categories: CategoryEntry[], viewMode: ViewMode): number | null {
  const catAvgs = categories
    .map((c) => getGroupCategoryAvg(groupTeachers, c.domains, viewMode))
    .filter((s): s is number => s !== null);
  return catAvgs.length ? avg(catAvgs) : null;
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

const BASE_PATH = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

export default function Dashboard() {
  const { currentUser } = useUser();
  const queryClient = useQueryClient();

  /* ── URL params: schoolId for district drill-down ─── */
  const search = useSearch();
  const searchParams = useMemo(() => new URLSearchParams(search), [search]);
  const schoolId = useMemo(() => {
    const v = searchParams.get("schoolId");
    return v ? Number(v) : null;
  }, [searchParams]);

  /* ── School name from URL param (for drill-down label) */
  const schoolName = useMemo(() => searchParams.get("schoolName") ?? null, [searchParams]);

  /* ── ?teacher=<id> — auto-open teacher profile on load */
  const urlTeacherId = useMemo(() => searchParams.get("teacher"), [searchParams]);

  /* ── Rubric set selection ──────────────────────────── */
  const [activeRubricSet, setActiveRubricSet] = useState<string>("Q1");

  const { data: allRubricSets = [] } = useQuery<RubricSetRow[]>({
    queryKey: ["rubricSets"],
    queryFn: fetchRubricSets,
    staleTime: 60_000,
  });
  const rubricSets = allRubricSets.filter((q) => !q.isArchived);

  useEffect(() => {
    if (rubricSets.length > 0 && !rubricSets.find((q) => q.slug === activeRubricSet)) {
      setActiveRubricSet(rubricSets[0].slug);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rubricSets]);

  /* ── API data ──────────────────────────────────────── */
  const isNetworkRole = currentUser?.role === "NETWORK_ADMIN" || currentUser?.role === "NETWORK_LEADER";
  const isDistrictHome = isNetworkRole && schoolId == null;

  // Use URL schoolId for district drill-down; otherwise fall back to user's own school
  const effectiveSchoolId = schoolId ?? (currentUser?.schoolId ?? null);

  /* ── View toggles — must be before walkthroughsOnly derivation ─── */
  const [viewMode, setViewMode] = useState<ViewMode>("recent");
  const [viewBy,   setViewBy]   = useState<ViewBy>("teacher");

  const walkthroughsOnly = viewMode === "walkthroughs";

  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard", activeRubricSet, effectiveSchoolId, walkthroughsOnly],
    queryFn: () => fetchDashboard(activeRubricSet, effectiveSchoolId, walkthroughsOnly),
    staleTime: 30_000,
    enabled: !isDistrictHome,
  });

  const teachers: Teacher[]       = data?.teachers   ?? [];
  const categories: CategoryEntry[] = data?.categories ?? [];
  const allDomains: DomainEntry[] = categories.flatMap((c) => c.domains);
  const rubricSetId: number       = data?.rubricSet.id ?? 0;

  /* ── Domain tooltip state ──────────────────────────── */
  const [domainTooltip, setDomainTooltip] = useState<{ slug: string; x: number; y: number; description: string } | null>(null);

  /* ── Filter state ──────────────────────────────────── */
  const [subject, setSubject]       = useState<string[]>([]);
  const [grade, setGrade]           = useState<string[]>([]);
  const [proficiency, setProficiency] = useState<string[]>([]);

  /* ── Teacher profile ───────────────────────────────── */
  const [teacherProfileId, setTeacherProfileId] = useState<string | null>(null);

  /* Auto-open profile when ?teacher=<id> is present and data has loaded */
  useEffect(() => {
    if (urlTeacherId && teachers.length > 0) {
      setTeacherProfileId(urlTeacherId);
    }
  }, [urlTeacherId, teachers.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const viewportHeight = useViewportHeight();

  /* ── Filter bar height measurement for sticky thead ── */
  const filterBarRef = useRef<HTMLDivElement>(null);
  const [filterBarHeight, setFilterBarHeight] = useState(0);
  useEffect(() => {
    const el = filterBarRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFilterBarHeight(el.offsetHeight));
    ro.observe(el);
    setFilterBarHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

  /* ── Modal state ───────────────────────────────────── */
  const [newObsOpen, setNewObsOpen] = useState(false);
  const [drillDown, setDrillDown]   = useState<DrillDownTarget | null>(null);
  const [saving, setSaving]         = useState(false);

  /* ── Derived lists (always computed — hooks must come before any return) */
  const filtered = useMemo(() => {
    return teachers.filter((t) => {
      if (subject.length  && !subject.includes(t.subject)) return false;
      if (grade.length && !t.gradeLevel.some((g) => grade.includes(g))) return false;
      return true;
    });
  }, [teachers, subject, grade, viewBy]);

  const groupRows = useMemo(
    () => (viewBy !== "teacher" ? buildGroups(filtered, viewBy) : []),
    [filtered, viewBy],
  );

  const teacherAvgFn = (t: Teacher) => getTeacherOverallAvg(t, categories, viewMode);

  const groupAvgs = useMemo(
    () => groupRows.map((g) => getGroupOverallAvg(g.teachers, categories, viewMode)),
    [groupRows, categories, viewMode],
  );

  /* ── Proficiency filter (applied after subject/grade) ── */
  const profActive = proficiency.length === 1 ? proficiency[0] : null;

  const profFiltered = useMemo(() => {
    if (!profActive) return filtered;
    return filtered.filter((t) => {
      const a = teacherAvgFn(t);
      if (a === null) return false;
      return profActive === "Proficient" ? a >= 0.7 : a < 0.7;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, profActive, categories, viewMode]);

  const profGroupRows = useMemo(() => {
    if (!profActive) return groupRows;
    return groupRows.filter((g) => {
      const a = getGroupOverallAvg(g.teachers, categories, viewMode);
      if (a === null) return false;
      return profActive === "Proficient" ? a >= 0.7 : a < 0.7;
    });
  }, [groupRows, profActive, categories, viewMode]);

  /* ── Route DISTRICT_ADMIN → DistrictDashboard ─────── */
  if (isDistrictHome) {
    return (
      <DistrictDashboard
        onDrillDown={(id, name) => {
          const params = new URLSearchParams({ schoolId: String(id), schoolName: name });
          window.location.href = `${BASE_PATH}/?${params.toString()}`;
        }}
      />
    );
  }

  /* ── Stats — teacher view ──────────────────────────── */

  const profGroupAvgs = profGroupRows.map((g) => getGroupOverallAvg(g.teachers, categories, viewMode));

  const statCount        = viewBy === "teacher" ? profFiltered.length : profGroupRows.length;
  const filteredAvgs     = viewBy === "teacher"
    ? profFiltered.map((t) => teacherAvgFn(t)).filter((a): a is number => a !== null)
    : profGroupAvgs;
  /* Always compute school-wide average from individual teacher scores,
     never from group subtotals, so it stays consistent across all view modes. */
  const teacherAvgsForStat = profFiltered
    .map((t) => teacherAvgFn(t))
    .filter((a): a is number => a !== null);
  const statAvg = teacherAvgsForStat.length
    ? teacherAvgsForStat.reduce((a, b) => a + b, 0) / teacherAvgsForStat.length
    : 0;
  const statProficient   = viewBy === "teacher"
    ? profFiltered.filter((t) => { const a = teacherAvgFn(t); return a !== null && a >= 0.7; }).length
    : profGroupAvgs.filter((a): a is number => a !== null && a >= 0.7).length;
  const statNeedsSupport = viewBy === "teacher"
    ? profFiltered.filter((t) => { const a = teacherAvgFn(t); return a !== null && a < 0.7; }).length
    : profGroupAvgs.filter((a): a is number => a !== null && a < 0.7).length;

  const hasFilters = !!(subject.length || grade.length || proficiency.length);

  /* ── Handlers ──────────────────────────────────────── */
  async function handleNewObservation(
    teacherId: string,
    date: string,
    scores: Record<string, Score>,
    strengths: string,
    growthAreas: string,
    isWalkthrough: boolean,
  ) {
    if (!rubricSetId) return;
    setSaving(true);
    try {
      await createObservation({
        teacherId,
        rubricSetId,
        date,
        scores,
        strengths:    strengths || undefined,
        growthAreas:  growthAreas || undefined,
        observer:     currentUser?.name ?? "Unknown",
        observerId:   currentUser?.id,
        isWalkthrough,
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
  const firstColLabel = viewBy === "teacher" ? "Teacher / Subject"
    : viewBy === "subject" ? "Subject"
    : "Grade Level";

  const rowCountLabel = viewBy === "teacher" ? "Teachers Shown"
    : viewBy === "subject" ? "Subjects"
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
        onNewObs={() => setNewObsOpen(true)}
      />
    ) : (
    <div className="flex flex-col" style={{ height: viewportHeight, overflow: "clip", backgroundColor: "#F4F6FB", fontFamily: "'Libre Franklin', sans-serif" }}>

      {/* ══ HEADER ═════════════════════════════════════════════ */}
      {currentUser && (
        <div className="sticky top-0 z-30 shadow-md">
          <AppHeader
            subtitle={schoolName ?? currentUser.schoolName ?? ""}
            basePath={BASE_PATH}
            onAddObservation={() => setNewObsOpen(true)}
            actionCenterHref={`${BASE_PATH}/action-center`}
            userName={currentUser.name}
            userRole={currentUser.role}
            canAdmin={currentUser.role !== "COACH"}
            {...(isNetworkRole && schoolId != null
              ? { backHref: BASE_PATH + "/", backLabel: "Network" }
              : {})}
          />
        </div>
      )}

      {/* ══ MAIN ════════════════════════════════════════════════ */}
      <main className="px-3 sm:px-5 py-3 sm:py-4 flex flex-col gap-3 flex-1 min-h-0 overflow-auto">

        {/* ── Rubric Set Switcher ────────────────────────────── */}
        {rubricSets.length > 0 && (
          <div
            className="bg-white rounded-md px-3 sm:px-4 py-2 flex flex-wrap items-center gap-2"
            style={{ border: "1px solid #dde3f0", borderLeft: `3px solid ${YELLOW}` }}
          >
            <span
              className="font-bold uppercase tracking-widest shrink-0"
              style={{ color: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, letterSpacing: "0.03em" }}
            >
              Rubric
            </span>
            <div className="flex gap-1.5 flex-wrap">
              {rubricSets.map((q) => {
                const active = q.slug === activeRubricSet;
                return (
                  <button
                    key={q.slug}
                    type="button"
                    onClick={() => setActiveRubricSet(q.slug)}
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

        {/* ── Stats ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-2.5">
          {[
            { label: rowCountLabel,          value: statCount,                                       pct: null,                                                                      colorScore: null as number | null },
            { label: "Average Score",         value: statCount ? statAvg.toFixed(1) : "—",           pct: null,                                                                      colorScore: statCount ? statAvg : null },
            { label: "Proficient (≥ 0.7)",   value: statProficient,    pct: statCount ? Math.round(statProficient    / statCount * 100) : null, colorScore: null as number | null },
            { label: "Not Proficient (< 0.7)", value: statNeedsSupport, pct: statCount ? Math.round(statNeedsSupport  / statCount * 100) : null, colorScore: null as number | null },
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
          ref={filterBarRef}
          className="bg-white rounded-md px-3 sm:px-4 py-2 sm:py-2.5 flex flex-wrap gap-2 sm:gap-3 items-center"
          style={{ border: "1px solid #dde3f0", borderLeft: `3px solid ${NAVY}`, position: "sticky", top: 0, zIndex: 25 }}
        >
          {/* "View By" label + pill buttons */}
          <span
            className="font-bold uppercase tracking-widest shrink-0"
            style={{ color: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: "0.03em" }}
          >
            View By
          </span>
          <div className="flex rounded-md overflow-hidden shrink-0" style={{ border: `1.5px solid ${NAVY}`, fontFamily: "'Bebas Neue', sans-serif" }}>
            {(["teacher", "subject", "grade"] as ViewBy[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewBy(mode)}
                className="px-3 sm:px-4 py-1.5 font-bold uppercase tracking-wider transition-colors"
                style={{
                  backgroundColor: viewBy === mode ? NAVY : "transparent",
                  color: viewBy === mode ? "white" : NAVY,
                  letterSpacing: "0.02em",
                  fontSize: 15,
                  borderRight: mode !== "grade" ? `1px solid ${NAVY}` : undefined,
                }}
              >
                {mode === "teacher" ? "Teacher" : mode === "subject" ? "Subject" : "Grade"}
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

          {/* Subject filter — hidden when grouped by subject */}
          {viewBy !== "subject" && (
            <FilterMultiSelect label="Subject" values={subject}  onChange={setSubject}  options={[...SUBJECTS]} />
          )}

          {/* Grade filter — hidden when grouped by grade */}
          {viewBy !== "grade" && (
            <FilterMultiSelect label="Grade"      values={grade} onChange={setGrade} options={[...GRADE_LEVELS]} />
          )}

          {/* Proficiency filter */}
          <FilterMultiSelect label="Proficiency" values={proficiency} onChange={setProficiency} options={["Proficient", "Not Yet"]} />

          {hasFilters && (
            <button
              onClick={() => { setSubject([]); setGrade([]); setProficiency([]); }}
              className="font-semibold underline underline-offset-2"
              style={{ color: NAVY, fontSize: 14 }}
            >
              Clear all
            </button>
          )}

          {/* Divider */}
          <div style={{ width: 1, height: 24, backgroundColor: "#dde3f0" }} className="hidden sm:block" />

          {/* View mode toggle — right-aligned */}
          <div className="ml-auto flex rounded-md overflow-hidden shrink-0" style={{ border: `1.5px solid ${NAVY}`, fontFamily: "'Bebas Neue', sans-serif" }}>
            {(["recent", "periodAvg", "walkthroughs"] as ViewMode[]).map((mode, i, arr) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className="px-4 py-1.5 font-bold uppercase tracking-wider transition-colors"
                style={{
                  backgroundColor: viewMode === mode ? NAVY : "transparent",
                  color: viewMode === mode ? "white" : NAVY,
                  letterSpacing: "0.02em",
                  fontSize: 15,
                  borderRight: i < arr.length - 1 ? `1px solid ${NAVY}` : undefined,
                }}
              >
                {mode === "recent" ? "Most Recent" : mode === "periodAvg" ? "Rubric Avg" : "Walkthroughs"}
              </button>
            ))}
          </div>
        </div>

        {/* ── Table ─────────────────────────────────────────── */}
        <div
          className="bg-white rounded-md shadow-sm"
          style={{ border: "1px solid #dde3f0" }}
        >
            <table className="border-collapse text-xs" style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}>
              <thead className="sticky z-20" style={{ top: filterBarHeight }}>

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
                      colSpan={cat.domains.length + 1}
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
                      width: 60, minWidth: 60,
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
                      paddingTop: 8, paddingBottom: 8,
                    }}
                  >
                    Proficient
                  </th>
                </tr>

                {/* Domain headers — vertical text, with sub-avg after each category */}
                <tr style={{ backgroundColor: "#0d2990" }}>
                  {categories.map((cat) => (
                    <Fragment key={cat.id}>
                      {cat.domains.map((domain, di) => {
                        const domainDesc = domain.description || "";
                        const hasDesc = !!domainDesc;
                        return (
                          <th
                            key={domain.id}
                            style={{
                              width: 60, minWidth: 60, height: 88,
                              color: "#c8d4f5",
                              borderLeft: di === 0 ? `2px solid ${YELLOW}` : "1px solid rgba(255,255,255,0.08)",
                              textAlign: "center",
                              verticalAlign: "top",
                              paddingTop: 8,
                              overflow: "visible",
                              cursor: hasDesc ? "help" : undefined,
                            }}
                            onMouseEnter={hasDesc ? (e) => {
                              const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
                              setDomainTooltip({ slug: domain.id, x: e.clientX / z, y: e.clientY / z + 16, description: domainDesc });
                            } : undefined}
                            onMouseMove={hasDesc ? (e) => {
                              const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
                              setDomainTooltip((prev) => prev ? { ...prev, x: e.clientX / z, y: e.clientY / z + 16 } : null);
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
                      })}
                      {/* Category sub-avg column header */}
                      <th
                        key={`subt-${cat.id}`}
                        style={{
                          width: 58, minWidth: 58, height: 88,
                          color: NAVY,
                          borderLeft: `3px solid ${YELLOW}`,
                          textAlign: "center",
                          verticalAlign: "top",
                          paddingTop: 8,
                          backgroundColor: YELLOW,
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
                            fontSize: "14px",
                            fontWeight: 800,
                            lineHeight: 1.3,
                            textTransform: "uppercase",
                            letterSpacing: "0.04em",
                          }}
                        >
                          Sub Avg
                        </div>
                      </th>
                    </Fragment>
                  ))}
                </tr>

                {/* Yellow separator */}
                <tr style={{ height: 3, backgroundColor: YELLOW }}>
                  <td colSpan={allDomains.length + categories.length + 3} style={{ padding: 0, height: 3, backgroundColor: YELLOW }} />
                </tr>

              </thead>
              <tbody>

                {/* ── TEACHER VIEW ─────────────────────────── */}
                {viewBy === "teacher" && (
                  profFiltered.length === 0 ? (
                    <tr>
                      <td colSpan={allDomains.length + categories.length + 3} className="text-center py-12 text-slate-400 text-sm">
                        No teachers match the current filters.
                      </td>
                    </tr>
                  ) : (
                    profFiltered.map((teacher, rowIdx) => {
                      const avg    = teacherAvgFn(teacher);
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
                              {teacher.subject} · Grade{teacher.gradeLevel.length !== 1 ? "s" : ""} {teacher.gradeLevel.join(", ")}
                            </p>
                          </td>

                          {categories.map((cat) => {
                            const catAvg = getCategoryAvg(teacher, cat.domains, viewMode);
                            return (
                              <Fragment key={cat.id}>
                                {cat.domains.map((domain, di) => {
                                  const score = viewMode === "periodAvg"
                                    ? getQuarterDomainScore(teacher, domain.id)
                                    : getMostRecentDomainScore(teacher, domain.id);
                                  const borderStyle = di === 0 ? { borderLeft: `2px solid ${YELLOW}` } : { borderLeft: "1px solid #e8edf8" };
                                  return (
                                    <ScoreCell
                                      key={domain.id}
                                      score={score}
                                      className="py-1.5"
                                      style={borderStyle}
                                      onClick={score !== null ? () => openDrillDown(teacher, domain.id, domain.label) : undefined}
                                    />
                                  );
                                })}
                                {/* Sub-avg cell */}
                                <td
                                  className={`text-center font-bold py-1.5 ${catAvg !== null ? getScoreColor(catAvg) : "text-slate-300"}`}
                                  style={{ borderLeft: `3px solid ${YELLOW}`, backgroundColor: catAvg !== null ? undefined : "#f7f9fd", fontFamily: "'Bebas Neue', sans-serif", fontSize: 20 }}
                                >
                                  {catAvg !== null ? catAvg.toFixed(1) : "—"}
                                </td>
                              </Fragment>
                            );
                          })}

                          {/* Overall avg */}
                          <td
                            className={`text-center font-bold py-1.5 ${avg !== null ? getScoreColor(avg) : "text-slate-300"}`}
                            style={{ borderLeft: `2px solid ${YELLOW}`, fontFamily: "'Bebas Neue', sans-serif", fontSize: 20 }}
                          >
                            {avg !== null ? avg.toFixed(1) : "—"}
                          </td>

                          {/* Proficient badge */}
                          <td className="text-center py-1.5 px-1" style={{ borderLeft: `2px solid ${YELLOW}` }}>
                            {avg !== null ? (
                              <span
                                className="inline-block px-2 py-0.5 rounded text-xs font-bold"
                                style={{
                                  backgroundColor: avg >= 0.7 ? "#dcfce7" : "#fee2e2",
                                  color: avg >= 0.7 ? "#15803d" : "#b91c1c",
                                }}
                              >
                                {avg >= 0.7 ? "Proficient" : "Not Yet"}
                              </span>
                            ) : (
                              <span className="text-slate-300 text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )
                )}

                {/* ── DEPARTMENT / GRADE ROLLUP VIEW ───────── */}
                {viewBy !== "teacher" && (
                  profGroupRows.length === 0 ? (
                    <tr>
                      <td colSpan={allDomains.length + categories.length + 3} className="text-center py-12 text-slate-400 text-sm">
                        No {viewBy === "subject" ? "subjects" : "grade levels"} match the current filters.
                      </td>
                    </tr>
                  ) : (
                    profGroupRows.map((group, rowIdx) => {
                      const groupAvg = getGroupOverallAvg(group.teachers, categories, viewMode);
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

                          {/* Averaged domain score cells + category sub-avg */}
                          {categories.map((cat) => {
                            const catAvg = getGroupCategoryAvg(group.teachers, cat.domains, viewMode);
                            return (
                              <Fragment key={cat.id}>
                                {cat.domains.map((domain, di) => {
                                  const score = getGroupDomainScore(group.teachers, domain.id, viewMode);
                                  const borderStyle = di === 0 ? { borderLeft: `2px solid ${YELLOW}` } : { borderLeft: "1px solid #e8edf8" };
                                  return score !== null ? (
                                    <td
                                      key={domain.id}
                                      className="text-center font-bold py-2"
                                      style={{ ...borderStyle, backgroundColor: "white", color: getScoreTextColor(score), fontFamily: "'Bebas Neue', sans-serif", fontSize: 20 }}
                                    >
                                      {score.toFixed(1)}
                                    </td>
                                  ) : (
                                    <td key={domain.id} className="text-center text-slate-300" style={{ ...borderStyle, backgroundColor: "white" }}>—</td>
                                  );
                                })}
                                {/* Group category sub-avg */}
                                <td
                                  className={`text-center font-bold py-2 ${catAvg !== null ? getScoreColor(catAvg) : "text-slate-300"}`}
                                  style={{ borderLeft: `3px solid ${YELLOW}`, fontFamily: "'Bebas Neue', sans-serif", fontSize: 20 }}
                                >
                                  {catAvg !== null ? catAvg.toFixed(1) : "—"}
                                </td>
                              </Fragment>
                            );
                          })}

                          {/* Group overall avg */}
                          <td
                            className={`text-center font-bold py-2 ${groupAvg !== null ? getScoreColor(groupAvg) : "text-slate-300"}`}
                            style={{ borderLeft: `2px solid ${YELLOW}`, fontFamily: "'Bebas Neue', sans-serif", fontSize: 20 }}
                          >
                            {groupAvg !== null ? groupAvg.toFixed(1) : "—"}
                          </td>

                          {/* Proficient badge */}
                          <td className="text-center py-2 px-1" style={{ borderLeft: `2px solid ${YELLOW}` }}>
                            {groupAvg !== null ? (
                              <span
                                className="inline-block px-2 py-0.5 rounded text-xs font-bold"
                                style={{
                                  backgroundColor: groupAvg >= 0.7 ? "#dcfce7" : "#fee2e2",
                                  color: groupAvg >= 0.7 ? "#15803d" : "#b91c1c",
                                }}
                              >
                                {groupAvg >= 0.7 ? "Proficient" : "Not Yet"}
                              </span>
                            ) : (
                              <span className="text-slate-300 text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )
                )}

                {/* ── DOMAIN AVERAGE FOOTER ─────────────────── */}
                {((viewBy === "teacher" && profFiltered.length > 0) || (viewBy !== "teacher" && profGroupRows.length > 0)) && (
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
                        fontSize: 20,
                        letterSpacing: "0.02em",
                      }}
                    >
                      Domain Avg
                    </td>
                    {categories.map((cat) => {
                      const catFooterAvg: number | null = viewBy === "teacher"
                        ? (() => {
                            const vals = profFiltered
                              .map((t) => getCategoryAvg(t, cat.domains, viewMode))
                              .filter((s): s is number => s !== null);
                            return vals.length ? avg(vals) : null;
                          })()
                        : (() => {
                            const vals = profGroupRows
                              .map((g) => getGroupCategoryAvg(g.teachers, cat.domains, viewMode))
                              .filter((s): s is number => s !== null);
                            return vals.length ? avg(vals) : null;
                          })();
                      return (
                        <Fragment key={cat.id}>
                          {cat.domains.map((domain, di) => {
                            const domAvg: number | null = viewBy === "teacher"
                              ? (viewMode === "periodAvg"
                                  ? getQuarterDomainAvg(domain.id, profFiltered)
                                  : (() => {
                                      const vals = profFiltered
                                        .map((t) => getMostRecentDomainScore(t, domain.id))
                                        .filter((s): s is number => s !== null);
                                      return vals.length ? avg(vals) : null;
                                    })())
                              : (() => {
                                  const vals = profGroupRows
                                    .map((g) => getGroupDomainScore(g.teachers, domain.id, viewMode))
                                    .filter((s): s is number => s !== null);
                                  return vals.length ? avg(vals) : null;
                                })();
                            return (
                              <td
                                key={domain.id}
                                className="text-center font-bold py-1.5"
                                style={{
                                  ...(di === 0 ? { borderLeft: `2px solid ${YELLOW}` } : { borderLeft: "1px solid rgba(255,181,0,0.25)" }),
                                  backgroundColor: "white",
                                  color: domAvg !== null ? getScoreTextColor(domAvg) : "#94a3b8",
                                  fontFamily: "'Bebas Neue', sans-serif",
                                  fontSize: 20,
                                }}
                              >
                                {domAvg !== null ? domAvg.toFixed(1) : "—"}
                              </td>
                            );
                          })}
                          {/* Category sub-avg footer cell */}
                          <td
                            className={`text-center font-bold py-1.5 ${catFooterAvg !== null ? getScoreColor(catFooterAvg) : "text-slate-400"}`}
                            style={{ borderLeft: `3px solid ${YELLOW}`, fontFamily: "'Bebas Neue', sans-serif", fontSize: 20 }}
                          >
                            {catFooterAvg !== null ? catFooterAvg.toFixed(1) : "—"}
                          </td>
                        </Fragment>
                      );
                    })}
                    <td
                      className={`text-center font-bold py-1.5 ${statAvg ? getScoreColor(statAvg) : "text-slate-400"}`}
                      style={{ borderLeft: `2px solid ${YELLOW}`, fontFamily: "'Bebas Neue', sans-serif", fontSize: 20 }}
                    >
                      {statAvg ? statAvg.toFixed(1) : "—"}
                    </td>
                    {/* Blank proficient cell in footer */}
                    <td style={{ borderLeft: `2px solid ${YELLOW}` }} />
                  </tr>
                )}
              </tbody>
            </table>
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
        canMarkWalkthrough={currentUser?.role === "NETWORK_ADMIN" || currentUser?.role === "NETWORK_LEADER" || currentUser?.role === "SCHOOL_LEADER"}
        observerName={currentUser?.name}
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

      {/* ── Domain tooltip overlay ───────────────────────── */}
      {domainTooltip && domainTooltip.description && (() => {
        const TW = 280;
        const PAD = 10;
        const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
        const vpW = window.innerWidth / z;
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
    </>
  );
}

