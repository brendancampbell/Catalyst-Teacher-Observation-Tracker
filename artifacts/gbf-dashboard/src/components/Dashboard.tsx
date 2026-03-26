import {
  CATEGORIES,
  ALL_DOMAINS,
  TEACHERS,
  getMostRecentObservation,
  getTeacherAverage,
  getDomainAverage,
  type Score,
} from "@/data/dummy";
import { ScoreCell, getScoreColorExact, getScoreColor } from "@/components/ScoreCell";

const SCORE_LEGEND = [
  { score: 1, label: "Needs Improvement", colorClass: "bg-red-100 text-red-900" },
  { score: 2, label: "Approaching", colorClass: "bg-yellow-100 text-yellow-900" },
  { score: 3, label: "Proficient", colorClass: "bg-green-200 text-green-900" },
  { score: 4, label: "Exemplary", colorClass: "bg-green-700 text-white" },
];

export default function Dashboard() {
  const currentUser = { name: "Principal Rivera", school: "Lincoln Elementary" };
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      {/* Top Nav */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-screen-2xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">GBF</span>
            </div>
            <div>
              <h1 className="text-base font-semibold text-slate-900 leading-tight">Get Better Faster</h1>
              <p className="text-xs text-slate-500">{currentUser.school}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-500">{today}</span>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center">
                <span className="text-blue-700 font-semibold text-xs">PR</span>
              </div>
              <span className="text-sm font-medium text-slate-700">{currentUser.name}</span>
              <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5 font-medium">Principal</span>
            </div>
          </div>
        </div>
      </header>

      {/* Page Content */}
      <main className="max-w-screen-2xl mx-auto px-6 py-8">
        {/* Page Header */}
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Observation Tracker</h2>
            <p className="text-sm text-slate-500 mt-0.5">Showing most recent observation scores for all teachers</p>
          </div>
          {/* Legend */}
          <div className="flex items-center gap-2">
            {SCORE_LEGEND.map(({ score, label, colorClass }) => (
              <div key={score} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 ${colorClass} text-xs font-semibold`}>
                <span>{score}</span>
                <span className="font-normal opacity-80">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Stats Summary */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[
            { label: "Total Teachers", value: TEACHERS.length },
            {
              label: "School Average",
              value: (TEACHERS.reduce((s, t) => s + getTeacherAverage(t), 0) / TEACHERS.length).toFixed(1),
            },
            {
              label: "Scoring ≥ 3 (Proficient)",
              value: TEACHERS.filter((t) => getTeacherAverage(t) >= 3).length,
            },
            {
              label: "Need Support (< 2)",
              value: TEACHERS.filter((t) => getTeacherAverage(t) < 2).length,
            },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white rounded-xl border border-slate-200 px-5 py-4 shadow-sm">
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
            </div>
          ))}
        </div>

        {/* Data Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                {/* Category header row */}
                <tr className="bg-slate-800 text-white">
                  <th
                    className="text-left px-4 py-3 font-semibold text-sm sticky left-0 bg-slate-800 z-10 min-w-[200px]"
                    rowSpan={2}
                  >
                    Teacher / Department
                  </th>
                  {CATEGORIES.map((cat) => (
                    <th
                      key={cat.id}
                      colSpan={cat.domains.length}
                      className="text-center px-3 py-3 font-semibold text-sm border-l border-slate-600"
                    >
                      {cat.label}
                    </th>
                  ))}
                  <th
                    className="text-center px-3 py-3 font-semibold text-sm border-l border-slate-600 min-w-[90px]"
                    rowSpan={2}
                  >
                    Teacher Avg
                  </th>
                </tr>
                {/* Domain sub-header row */}
                <tr className="bg-slate-700 text-slate-200">
                  {ALL_DOMAINS.map((domain, i) => {
                    const isFirstInCat = CATEGORIES.some((c) => c.domains[0].id === domain.id);
                    return (
                      <th
                        key={domain.id}
                        className={`text-center px-2 py-2.5 font-medium text-xs whitespace-nowrap ${isFirstInCat ? "border-l border-slate-500" : ""}`}
                        style={{ maxWidth: 120, minWidth: 80 }}
                      >
                        {domain.label}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {TEACHERS.map((teacher, rowIdx) => {
                  const obs = getMostRecentObservation(teacher);
                  const avg = getTeacherAverage(teacher);
                  const isEven = rowIdx % 2 === 0;

                  return (
                    <tr
                      key={teacher.id}
                      className={`border-b border-slate-100 hover:bg-blue-50/40 transition-colors ${isEven ? "bg-white" : "bg-slate-50/50"}`}
                    >
                      {/* Teacher info — sticky left column */}
                      <td className={`px-4 py-3 sticky left-0 z-10 border-r border-slate-200 ${isEven ? "bg-white" : "bg-slate-50"} hover:bg-blue-50/60`}>
                        <p className="font-semibold text-slate-800 text-sm">{teacher.name}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{teacher.department}</p>
                      </td>

                      {/* Score cells */}
                      {ALL_DOMAINS.map((domain) => {
                        const score = obs.scores[domain.id] as Score | undefined;
                        const isFirstInCat = CATEGORIES.some((c) => c.domains[0].id === domain.id);
                        return score !== undefined ? (
                          <ScoreCell
                            key={domain.id}
                            score={score}
                            className={isFirstInCat ? "border-l border-slate-200" : ""}
                          />
                        ) : (
                          <td key={domain.id} className="text-center text-slate-300 text-xs">—</td>
                        );
                      })}

                      {/* Teacher Average */}
                      <td className={`text-center text-sm font-bold px-3 py-2.5 border-l border-slate-200 ${getScoreColor(avg)}`}>
                        {avg.toFixed(1)}
                      </td>
                    </tr>
                  );
                })}

                {/* Domain Average row */}
                <tr className="bg-slate-800 text-white border-t-2 border-slate-300">
                  <td className="px-4 py-3 font-semibold text-sm sticky left-0 bg-slate-800 z-10 border-r border-slate-600">
                    Domain Average
                  </td>
                  {ALL_DOMAINS.map((domain) => {
                    const avg = getDomainAverage(domain.id);
                    const isFirstInCat = CATEGORIES.some((c) => c.domains[0].id === domain.id);
                    return (
                      <td
                        key={domain.id}
                        className={`text-center text-sm font-bold px-2 py-3 ${getScoreColor(avg)} ${isFirstInCat ? "border-l border-slate-600" : ""}`}
                      >
                        {avg.toFixed(1)}
                      </td>
                    );
                  })}
                  {/* Overall school avg */}
                  <td className={`text-center text-sm font-bold px-3 py-3 border-l border-slate-600 ${getScoreColor(TEACHERS.reduce((s, t) => s + getTeacherAverage(t), 0) / TEACHERS.length)}`}>
                    {(TEACHERS.reduce((s, t) => s + getTeacherAverage(t), 0) / TEACHERS.length).toFixed(1)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer note */}
        <p className="text-xs text-slate-400 text-center mt-4">
          Scores reflect most recent observation. Scale: 1 = Needs Improvement · 2 = Approaching · 3 = Proficient · 4 = Exemplary
        </p>
      </main>
    </div>
  );
}
