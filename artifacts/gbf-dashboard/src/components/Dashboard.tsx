import { useState, useMemo } from "react";
import { Plus } from "lucide-react";
import {
  CATEGORIES,
  ALL_DOMAINS,
  TEACHERS as INITIAL_TEACHERS,
  DEPARTMENTS,
  GRADE_LEVELS,
  EXP_BUCKETS,
  getMostRecentObservation,
  getTeacherAverage,
  getDomainAverage,
  getExpBucket,
  type Score,
  type Teacher,
  type Observation,
} from "@/data/dummy";
import { ScoreCell, getScoreColor } from "@/components/ScoreCell";
import { NewObservationModal } from "@/components/NewObservationModal";
import { DrillDownModal } from "@/components/DrillDownModal";
import { TeacherProfile } from "@/components/TeacherProfile";

type ViewMode = "recent" | "quarterAvg";

function getQuarterDomainScore(teacher: Teacher, domainId: string): number {
  const vals = teacher.observations
    .map((o) => o.scores[domainId] as Score | undefined)
    .filter((s): s is Score => s !== undefined);
  return vals.length ? vals.reduce((sum, s) => sum + s, 0) / vals.length : 0;
}

function getQuarterTeacherAvg(teacher: Teacher): number {
  const perDomain = ALL_DOMAINS.map((d) => getQuarterDomainScore(teacher, d.id));
  return perDomain.reduce((s, v) => s + v, 0) / perDomain.length;
}

function getQuarterDomainAvg(domainId: string, teachers: Teacher[]): number {
  const vals = teachers.map((t) => getQuarterDomainScore(t, domainId));
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

const NAVY = "#1034B4";
const YELLOW = "#FFB500";

type FilterStr = string;

interface DrillDownTarget {
  teacherId: string;
  domainId: string;
  domainLabel: string;
}

export default function Dashboard() {
  const currentUser = { name: "Principal Rivera", school: "Lincoln Elementary" };
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  /* ── Lifted state ──────────────────────────────────── */
  const [teachers, setTeachers] = useState<Teacher[]>(INITIAL_TEACHERS);

  /* ── Filter state ──────────────────────────────────── */
  const [search, setSearch]       = useState("");
  const [dept, setDept]           = useState<FilterStr>("");
  const [grade, setGrade]         = useState<FilterStr>("");
  const [expBucket, setExpBucket] = useState<FilterStr>("");

  /* ── View mode ─────────────────────────────────────── */
  const [viewMode, setViewMode]         = useState<ViewMode>("recent");

  /* ── Teacher profile ────────────────────────────────── */
  const [teacherProfileId, setTeacherProfileId] = useState<string | null>(null);

  /* ── Modal state ───────────────────────────────────── */
  const [newObsOpen, setNewObsOpen]     = useState(false);
  const [drillDown, setDrillDown]       = useState<DrillDownTarget | null>(null);

  /* ── Derived ───────────────────────────────────────── */
  const filtered = useMemo(() => {
    return teachers.filter((t) => {
      if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (dept     && t.department !== dept) return false;
      if (grade    && t.gradeLevel !== grade) return false;
      if (expBucket && getExpBucket(t.yearsExperience) !== expBucket) return false;
      return true;
    });
  }, [teachers, search, dept, grade, expBucket]);

  const avgFn        = (t: Teacher) => viewMode === "recent" ? getTeacherAverage(t) : getQuarterTeacherAvg(t);
  const schoolAvg    = filtered.length ? filtered.reduce((s, t) => s + avgFn(t), 0) / filtered.length : 0;
  const proficient   = filtered.filter((t) => avgFn(t) >= 3).length;
  const needsSupport = filtered.filter((t) => avgFn(t) < 2).length;
  const hasFilters   = !!(search || dept || grade || expBucket);

  /* ── Handlers ──────────────────────────────────────── */
  function handleNewObservation(
    teacherId: string,
    date: string,
    scores: Record<string, Score>,
    strengths: string,
    growthAreas: string,
  ) {
    const newObs: Observation = {
      id: `obs_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      date,
      scores,
      strengths: strengths || undefined,
      growthAreas: growthAreas || undefined,
      observer: currentUser.name,
    };
    setTeachers((prev) =>
      prev.map((t) =>
        t.id === teacherId
          ? { ...t, observations: [...t.observations, newObs] }
          : t,
      ),
    );
  }

  function handleUpdateObs(teacherId: string, updated: Observation) {
    setTeachers((prev) =>
      prev.map((t) =>
        t.id === teacherId
          ? { ...t, observations: t.observations.map((o) => (o.id === updated.id ? updated : o)) }
          : t,
      ),
    );
  }

  function openDrillDown(teacher: Teacher, domainId: string, domainLabel: string) {
    setDrillDown({ teacherId: teacher.id, domainId, domainLabel });
  }

  const profileTeacher = teacherProfileId ? (teachers.find((t) => t.id === teacherProfileId) ?? null) : null;

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

          {/* Logo + app name */}
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
                style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: "0.12em" }}
              >
                Get Better Faster Tracker
              </p>
              <p className="text-blue-200 font-medium truncate" style={{ fontSize: 15 }}>{currentUser.school}</p>
            </div>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <span className="text-blue-200 hidden md:block" style={{ fontSize: 15 }}>{today}</span>

            {/* ── Add Observation button ── */}
            <button
              onClick={() => setNewObsOpen(true)}
              className="flex items-center gap-1.5 font-bold rounded-md px-3 sm:px-4 py-2 transition-opacity hover:opacity-90 shadow-sm"
              style={{
                backgroundColor: YELLOW,
                color: NAVY,
                fontFamily: "'Barlow Condensed', sans-serif",
                fontSize: 15,
                letterSpacing: "0.06em",
              }}
            >
              <Plus size={16} strokeWidth={3} />
              <span className="hidden sm:inline">Add Observation</span>
            </button>

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
            { label: "Teachers Shown",     value: filtered.length,                                 pct: null, colorScore: null as number | null },
            { label: "Average Score",      value: filtered.length ? schoolAvg.toFixed(1) : "—",   pct: null, colorScore: filtered.length ? schoolAvg : null },
            { label: "Proficient+ (≥ 3)", value: proficient,    pct: filtered.length ? Math.round(proficient    / filtered.length * 100) : null, colorScore: null as number | null },
            { label: "Need Support (< 2)", value: needsSupport, pct: filtered.length ? Math.round(needsSupport  / filtered.length * 100) : null, colorScore: null as number | null },
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
                    <span className="font-bold leading-none pr-3" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: NAVY, fontWeight: 800, fontSize: 36, borderRight: `2px solid #dde3f0` }}>
                      {value}
                    </span>
                    <span className="font-bold leading-none pl-3" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: NAVY, fontWeight: 800, fontSize: 36 }}>
                      {pct}%
                    </span>
                  </div>
                ) : colorScore !== null ? (
                  <span
                    className={`inline-block font-bold mt-1 leading-none px-3 py-1 rounded-md ${getScoreColor(colorScore)}`}
                    style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, fontSize: 36 }}
                  >
                    {value}
                  </span>
                ) : (
                  <p
                    className="font-bold mt-1 leading-none"
                    style={{ fontFamily: "'Barlow Condensed', sans-serif", color: NAVY, fontWeight: 800, fontSize: 36 }}
                  >
                    {value}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* ── Filters ───────────────────────────────────────── */}
        <div
          className="bg-white rounded-md px-3 sm:px-4 py-2 sm:py-2.5 flex flex-wrap gap-2 sm:gap-3 items-center"
          style={{ border: "1px solid #dde3f0", borderLeft: `3px solid ${NAVY}` }}
        >
          <span
            className="font-bold uppercase tracking-widest shrink-0"
            style={{ color: NAVY, fontFamily: "'Barlow Condensed', sans-serif", fontSize: 16, letterSpacing: "0.1em" }}
          >
            Filters
          </span>

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

          <FilterSelect label="Department"  value={dept}      onChange={setDept}      options={[...DEPARTMENTS]} />
          <FilterSelect label="Grade Level" value={grade}     onChange={setGrade}     options={[...GRADE_LEVELS]} />
          <FilterSelect label="Experience"  value={expBucket} onChange={setExpBucket} options={[...EXP_BUCKETS]} />

          {hasFilters && (
            <button
              onClick={() => { setSearch(""); setDept(""); setGrade(""); setExpBucket(""); }}
              className="font-semibold underline underline-offset-2"
              style={{ color: NAVY, fontSize: 14 }}
            >
              Clear all
            </button>
          )}

          {/* View mode toggle — right-aligned */}
          <div className="ml-auto flex rounded-md overflow-hidden shrink-0" style={{ border: `1.5px solid ${NAVY}`, fontFamily: "'Barlow Condensed', sans-serif" }}>
            {(["recent", "quarterAvg"] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className="px-4 py-1.5 font-bold uppercase tracking-wider transition-colors"
                style={{
                  backgroundColor: viewMode === mode ? NAVY : "transparent",
                  color: viewMode === mode ? "white" : NAVY,
                  letterSpacing: "0.07em",
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
                      fontFamily: "'Barlow Condensed', sans-serif",
                      fontWeight: 700,
                      fontSize: 18,
                      letterSpacing: "0.08em",
                    }}
                  >
                    Teacher / Dept
                  </th>

                  {CATEGORIES.map((cat) => (
                    <th
                      key={cat.id}
                      colSpan={cat.domains.length}
                      className="text-center font-bold uppercase tracking-wider text-white"
                      style={{
                        fontFamily: "'Barlow Condensed', sans-serif",
                        fontSize: 18,
                        letterSpacing: "0.08em",
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
                      fontFamily: "'Barlow Condensed', sans-serif",
                      fontWeight: 700,
                      fontSize: 18,
                      letterSpacing: "0.08em",
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
                  {ALL_DOMAINS.map((domain) => {
                    const isFirstInCat = CATEGORIES.some((c) => c.domains[0].id === domain.id);
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

                {/* Thick yellow separator under headers */}
                <tr style={{ height: 3, backgroundColor: YELLOW }}>
                  <td colSpan={ALL_DOMAINS.length + 2} style={{ padding: 0, height: 3, backgroundColor: YELLOW }} />
                </tr>

              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={ALL_DOMAINS.length + 2} className="text-center py-12 text-slate-400 text-sm">
                      No teachers match the current filters.
                    </td>
                  </tr>
                ) : (
                  filtered.map((teacher, rowIdx) => {
                    const recent = getMostRecentObservation(teacher);
                    const avg    = viewMode === "recent" ? getTeacherAverage(teacher) : getQuarterTeacherAvg(teacher);
                    const isEven = rowIdx % 2 === 0;

                    return (
                      <tr
                        key={teacher.id}
                        className="border-b transition-colors"
                        style={{ borderColor: "#e8edf8", backgroundColor: isEven ? "#ffffff" : "#f7f9fd" }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#eef2fc")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = isEven ? "#ffffff" : "#f7f9fd")}
                      >
                        {/* Teacher cell — sticky */}
                        <td
                          className="pl-3 pr-2 py-1.5 sticky left-0 z-10"
                          style={{
                            width: 180,
                            backgroundColor: isEven ? "#ffffff" : "#f7f9fd",
                            borderRight: `2px solid ${YELLOW}`,
                          }}
                        >
                          <button
                            className="font-semibold leading-tight truncate text-left w-full hover:underline"
                            style={{ color: NAVY, fontSize: 15, cursor: "pointer" }}
                            onClick={() => setTeacherProfileId(teacher.id)}
                          >
                            {teacher.name}
                          </button>
                          <p className="text-slate-400 mt-px" style={{ fontSize: 12 }}>
                            {teacher.department} · {teacher.gradeLevel} · {teacher.yearsExperience}yr
                          </p>
                        </td>

                        {/* Score cells — clickable */}
                        {ALL_DOMAINS.map((domain) => {
                          const score = viewMode === "recent"
                            ? (recent.scores[domain.id] as Score | undefined)
                            : getQuarterDomainScore(teacher, domain.id);
                          const isFirstInCat = CATEGORIES.some((c) => c.domains[0].id === domain.id);
                          return score !== undefined && score !== 0 ? (
                            <ScoreCell
                              key={domain.id}
                              score={score}
                              className="py-1.5"
                              style={isFirstInCat ? { borderLeft: `2px solid ${YELLOW}` } : { borderLeft: "1px solid #e8edf8" }}
                              onClick={() => openDrillDown(teacher, domain.id, domain.label)}
                            />
                          ) : (
                            <td key={domain.id} className="text-center text-slate-300">—</td>
                          );
                        })}

                        {/* Teacher avg */}
                        <td
                          className={`text-center font-bold py-1.5 ${getScoreColor(avg)}`}
                          style={{ borderLeft: `2px solid ${YELLOW}` }}
                        >
                          {avg.toFixed(1)}
                        </td>
                      </tr>
                    );
                  })
                )}

                {/* Domain average footer row */}
                {filtered.length > 0 && (
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
                        fontFamily: "'Barlow Condensed', sans-serif",
                        fontWeight: 700,
                        fontSize: 16,
                        letterSpacing: "0.07em",
                      }}
                    >
                      Domain Avg
                    </td>
                    {ALL_DOMAINS.map((domain) => {
                      const avg          = viewMode === "recent"
                        ? getDomainAverage(domain.id, filtered)
                        : getQuarterDomainAvg(domain.id, filtered);
                      const isFirstInCat = CATEGORIES.some((c) => c.domains[0].id === domain.id);
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
                      className={`text-center font-bold py-1.5 ${getScoreColor(schoolAvg)}`}
                      style={{ borderLeft: `2px solid ${YELLOW}` }}
                    >
                      {schoolAvg.toFixed(1)}
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

      {/* ══ MODALS — always rendered ═══════════════════════════ */}
      <NewObservationModal
        teachers={teachers}
        open={newObsOpen}
        onOpenChange={setNewObsOpen}
        onSubmit={handleNewObservation}
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

/* ── Filter select ──────────────────────────────── */
function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: string[];
}) {
  const active = !!value;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="py-1.5 pl-3 pr-7 rounded focus:outline-none appearance-none cursor-pointer font-medium"
      style={{
        fontSize: 14,
        border: `1px solid ${active ? NAVY : "#dde3f0"}`,
        backgroundColor: active ? "#eef2fc" : "#F4F6FB",
        color: active ? NAVY : "#64748b",
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none' viewBox='0 0 10 6'%3E%3Cpath stroke='%231034B4' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m1 1 4 4 4-4'/%3E%3C/svg%3E")`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 8px center",
      }}
    >
      <option value="">{label}: All</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
