import { useState, useMemo } from "react";
import {
  CATEGORIES,
  ALL_DOMAINS,
  TEACHERS,
  DEPARTMENTS,
  GRADE_LEVELS,
  EXP_BUCKETS,
  getMostRecentObservation,
  getTeacherAverage,
  getDomainAverage,
  getExpBucket,
  type Score,
} from "@/data/dummy";
import { ScoreCell, getScoreColor } from "@/components/ScoreCell";

const SCORE_LEGEND = [
  { score: 1, label: "Needs Improvement", colorClass: "bg-red-100 text-red-900 border border-red-200" },
  { score: 2, label: "Approaching",        colorClass: "bg-yellow-100 text-yellow-900 border border-yellow-200" },
  { score: 3, label: "Proficient",         colorClass: "bg-green-100 text-green-900 border border-green-200" },
  { score: 4, label: "Exemplary",          colorClass: "bg-green-700 text-white border border-green-800" },
];

type FilterSelect = string; // "" means "All"

export default function Dashboard() {
  const currentUser = { name: "Principal Rivera", school: "Lincoln Elementary" };
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const [search, setSearch]       = useState("");
  const [dept, setDept]           = useState<FilterSelect>("");
  const [grade, setGrade]         = useState<FilterSelect>("");
  const [expBucket, setExpBucket] = useState<FilterSelect>("");

  const filtered = useMemo(() => {
    return TEACHERS.filter((t) => {
      if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (dept  && t.department !== dept)  return false;
      if (grade && t.gradeLevel !== grade) return false;
      if (expBucket && getExpBucket(t.yearsExperience) !== expBucket) return false;
      return true;
    });
  }, [search, dept, grade, expBucket]);

  const schoolAvg = filtered.length
    ? filtered.reduce((s, t) => s + getTeacherAverage(t), 0) / filtered.length
    : 0;
  const proficientCount = filtered.filter((t) => getTeacherAverage(t) >= 3).length;
  const needSupportCount = filtered.filter((t) => getTeacherAverage(t) < 2).length;

  const hasActiveFilters = !!(search || dept || grade || expBucket);

  return (
    <div className="min-h-screen bg-slate-50 font-sans flex flex-col">
      {/* ── Top Nav ─────────────────────────────────── */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shrink-0">
        <div className="px-5 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-blue-600 flex items-center justify-center shrink-0">
              <span className="text-white font-bold text-xs">GBF</span>
            </div>
            <div>
              <h1 className="text-sm font-semibold text-slate-900 leading-tight">Get Better Faster</h1>
              <p className="text-[11px] text-slate-400">{currentUser.school}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400 hidden sm:block">{today}</span>
            <div className="flex items-center gap-1.5">
              <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center">
                <span className="text-blue-700 font-semibold text-[10px]">PR</span>
              </div>
              <span className="text-xs font-medium text-slate-700 hidden sm:block">{currentUser.name}</span>
              <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-1.5 py-0.5 font-medium">Principal</span>
            </div>
          </div>
        </div>
      </header>

      <main className="px-5 py-4 flex flex-col gap-3 flex-1 min-h-0">
        {/* ── Page Title + Legend ───────────────────── */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900">Observation Tracker</h2>
            <p className="text-[11px] text-slate-400">Most recent scores · {filtered.length} teacher{filtered.length !== 1 ? "s" : ""}{hasActiveFilters ? " (filtered)" : ""}</p>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {SCORE_LEGEND.map(({ score, label, colorClass }) => (
              <span key={score} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${colorClass}`}>
                {score} <span className="font-normal opacity-75">{label}</span>
              </span>
            ))}
          </div>
        </div>

        {/* ── Stats Row ─────────────────────────────── */}
        <div className="grid grid-cols-4 gap-2.5">
          {[
            { label: "Teachers Shown",        value: filtered.length },
            { label: "Avg Score",             value: filtered.length ? schoolAvg.toFixed(1) : "—" },
            { label: "Proficient+ (≥ 3)",     value: proficientCount },
            { label: "Need Support (< 2)",    value: needSupportCount },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white rounded-lg border border-slate-200 px-3.5 py-2.5 shadow-sm">
              <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">{label}</p>
              <p className="text-xl font-bold text-slate-900 mt-0.5">{value}</p>
            </div>
          ))}
        </div>

        {/* ── Filters Row ───────────────────────────── */}
        <div className="bg-white border border-slate-200 rounded-lg px-3.5 py-2.5 flex flex-wrap gap-2 items-center shadow-sm">
          <span className="text-xs font-semibold text-slate-500 shrink-0">Filters:</span>

          {/* Search */}
          <div className="relative">
            <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <input
              type="search"
              placeholder="Search teacher…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-6 pr-2.5 py-1 text-xs rounded border border-slate-200 bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-400 w-36"
            />
          </div>

          <FilterSelect label="Department" value={dept} onChange={setDept} options={[...DEPARTMENTS]} />
          <FilterSelect label="Grade Level" value={grade} onChange={setGrade} options={[...GRADE_LEVELS]} />
          <FilterSelect label="Experience" value={expBucket} onChange={setExpBucket} options={[...EXP_BUCKETS]} />

          {hasActiveFilters && (
            <button
              onClick={() => { setSearch(""); setDept(""); setGrade(""); setExpBucket(""); }}
              className="text-[11px] text-blue-600 hover:text-blue-800 underline underline-offset-2 font-medium"
            >
              Clear all
            </button>
          )}
        </div>

        {/* ── Data Table ────────────────────────────── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex-1 min-h-0">
          <div className="overflow-auto h-full">
            <table className="border-collapse text-xs" style={{ tableLayout: "fixed", width: "max-content", minWidth: "100%" }}>
              <thead className="sticky top-0 z-20">
                {/* Category header row */}
                <tr className="bg-slate-800 text-white">
                  <th
                    rowSpan={2}
                    className="text-left pl-3 pr-2 py-2 font-semibold text-xs sticky left-0 bg-slate-800 z-30 border-r border-slate-600"
                    style={{ width: 180, minWidth: 180 }}
                  >
                    Teacher / Dept
                  </th>
                  {CATEGORIES.map((cat) => (
                    <th
                      key={cat.id}
                      colSpan={cat.domains.length}
                      className="text-center px-2 py-2 font-semibold text-xs border-l border-slate-600"
                    >
                      {cat.label}
                    </th>
                  ))}
                  <th
                    rowSpan={2}
                    className="text-center px-1 py-2 font-semibold text-xs border-l border-slate-600"
                    style={{ width: 56, minWidth: 56 }}
                  >
                    Avg
                  </th>
                </tr>
                {/* Domain sub-header row — vertical text */}
                <tr className="bg-slate-700 text-slate-200">
                  {ALL_DOMAINS.map((domain) => {
                    const isFirstInCat = CATEGORIES.some((c) => c.domains[0].id === domain.id);
                    return (
                      <th
                        key={domain.id}
                        className={`text-center font-medium align-bottom pb-1 pt-0 ${isFirstInCat ? "border-l border-slate-500" : ""}`}
                        style={{ width: 48, minWidth: 48, height: 110 }}
                      >
                        <div
                          style={{
                            writingMode: "vertical-rl",
                            transform: "rotate(180deg)",
                            whiteSpace: "normal",
                            maxHeight: 108,
                            lineHeight: 1.2,
                            fontSize: "10px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-start",
                            margin: "0 auto",
                            padding: "2px 0",
                          }}
                        >
                          {domain.label}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={ALL_DOMAINS.length + 2} className="text-center py-10 text-slate-400 text-sm">
                      No teachers match the current filters.
                    </td>
                  </tr>
                ) : (
                  filtered.map((teacher, rowIdx) => {
                    const recent = getMostRecentObservation(teacher);
                    const avg = getTeacherAverage(teacher);
                    const isEven = rowIdx % 2 === 0;

                    return (
                      <tr
                        key={teacher.id}
                        className={`border-b border-slate-100 hover:bg-blue-50/50 transition-colors ${isEven ? "bg-white" : "bg-slate-50/60"}`}
                      >
                        {/* Teacher cell — sticky */}
                        <td
                          className={`pl-3 pr-2 py-1.5 sticky left-0 z-10 border-r border-slate-200 ${isEven ? "bg-white" : "bg-slate-50"}`}
                          style={{ width: 180 }}
                        >
                          <p className="font-semibold text-slate-800 text-xs leading-tight truncate">{teacher.name}</p>
                          <p className="text-[10px] text-slate-400 mt-px">
                            {teacher.department} · {teacher.gradeLevel} · {teacher.yearsExperience}yr
                          </p>
                        </td>

                        {/* Score cells */}
                        {ALL_DOMAINS.map((domain) => {
                          const score = recent.scores[domain.id] as Score | undefined;
                          const isFirstInCat = CATEGORIES.some((c) => c.domains[0].id === domain.id);
                          return score !== undefined ? (
                            <ScoreCell
                              key={domain.id}
                              score={score}
                              className={`py-1.5 ${isFirstInCat ? "border-l border-slate-200" : ""}`}
                            />
                          ) : (
                            <td key={domain.id} className="text-center text-slate-300">—</td>
                          );
                        })}

                        {/* Teacher Avg */}
                        <td className={`text-center font-bold px-1 py-1.5 border-l border-slate-200 ${getScoreColor(avg)}`}>
                          {avg.toFixed(1)}
                        </td>
                      </tr>
                    );
                  })
                )}

                {/* Domain Average row */}
                {filtered.length > 0 && (
                  <tr className="bg-slate-800 text-white border-t-2 border-slate-400 sticky bottom-0 z-20">
                    <td className="pl-3 pr-2 py-1.5 font-semibold text-xs sticky left-0 bg-slate-800 z-30 border-r border-slate-600">
                      Domain Avg
                    </td>
                    {ALL_DOMAINS.map((domain) => {
                      const avg = getDomainAverage(domain.id, filtered);
                      const isFirstInCat = CATEGORIES.some((c) => c.domains[0].id === domain.id);
                      return (
                        <td
                          key={domain.id}
                          className={`text-center font-bold px-1 py-1.5 ${getScoreColor(avg)} ${isFirstInCat ? "border-l border-slate-600" : ""}`}
                        >
                          {avg.toFixed(1)}
                        </td>
                      );
                    })}
                    <td className={`text-center font-bold px-1 py-1.5 border-l border-slate-600 ${getScoreColor(schoolAvg)}`}>
                      {schoolAvg.toFixed(1)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}

/* ── Tiny reusable filter select ──────────────────── */
function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`py-1 pl-2 pr-6 text-xs rounded border bg-slate-50 focus:outline-none focus:ring-1 focus:ring-blue-400 appearance-none cursor-pointer ${
        value ? "border-blue-400 text-blue-700 font-medium bg-blue-50" : "border-slate-200 text-slate-600"
      }`}
      style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none' viewBox='0 0 10 6'%3E%3Cpath stroke='%2394a3b8' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m1 1 4 4 4-4'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center" }}
    >
      <option value="">{label}: All</option>
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}
