import { useMemo } from "react";
import { ArrowLeft, TrendingUp, TrendingDown, Minus, CalendarDays, BookOpen, Star, Plus } from "lucide-react";
import { CATEGORIES, getMostRecentObservation, type Teacher, type Observation, type Score } from "@/data/dummy";
import { getScoreColor, getScoreColorExact } from "@/components/ScoreCell";
import { useUser } from "@/context/UserContext";

const NAVY = "#1034B4";
const YELLOW = "#FFB500";

const SCORE_LABELS: Record<number, string> = {
  1: "Needs Improvement",
  2: "Approaching",
  3: "Proficient",
  4: "Exemplary",
};

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });
}

function ScoreChip({ score }: { score: Score }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded font-bold text-sm ${getScoreColorExact(score)}`}>
      {score} <span className="font-normal text-xs opacity-80">{SCORE_LABELS[score]}</span>
    </span>
  );
}

function ObservationCard({ obs, index }: { obs: Observation; index: number }) {
  const domains = CATEGORIES.flatMap((c) => c.domains);
  const scores = domains
    .map((d) => obs.scores[d.id] as Score | undefined)
    .filter((s): s is Score => s !== undefined);
  const avg = scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : null;
  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ borderColor: index === 0 ? YELLOW : "#e2e8f0", boxShadow: index === 0 ? `0 0 0 1.5px ${YELLOW}` : undefined }}
    >
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ backgroundColor: index === 0 ? NAVY : "#f8fafc" }}
      >
        <div className="flex items-center gap-2.5">
          {index === 0 && (
            <span
              className="text-xs font-bold uppercase tracking-wider rounded px-2 py-0.5"
              style={{ backgroundColor: YELLOW, color: NAVY }}
            >
              Most Recent
            </span>
          )}
          <span
            className="font-semibold text-sm"
            style={{ color: index === 0 ? "white" : "#374151" }}
          >
            {formatDate(obs.date)}
          </span>
          <span
            className="text-xs"
            style={{ color: index === 0 ? "#93c5fd" : "#94a3b8" }}
          >
            by {obs.observer}
          </span>
        </div>
        {avg !== null && (
          <span className={`font-bold text-sm px-3 py-1 rounded ${getScoreColor(avg)}`}>
            {avg.toFixed(1)} avg
          </span>
        )}
      </div>

      <div className="px-4 py-3 space-y-3">
        {CATEGORIES.map((cat) => (
          <div key={cat.id}>
            <p
              className="text-xs font-bold uppercase tracking-wider mb-1.5"
              style={{ color: NAVY, fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.02em" }}
            >
              {cat.label}
            </p>
            <div className="flex flex-wrap gap-2">
              {cat.domains.map((d) => {
                const s = obs.scores[d.id] as Score | undefined;
                if (!s) return null;
                return (
                  <div key={d.id} className="flex items-center gap-1.5">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${getScoreColorExact(s)}`}>
                      {s}
                    </span>
                    <span className="text-xs text-slate-500">{d.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {(obs.strengths || obs.growthAreas) && (
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: "#16a34a" }}>✦ Glows</p>
              <p className="text-sm text-slate-600 leading-relaxed">
                {obs.strengths || <span className="italic text-slate-400">None recorded</span>}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: "#ea580c" }}>↑ Grows</p>
              <p className="text-sm text-slate-600 leading-relaxed">
                {obs.growthAreas || <span className="italic text-slate-400">None recorded</span>}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface Props {
  teacher: Teacher;
  onBack: () => void;
  onNewObs: () => void;
}

export function TeacherProfile({ teacher, onBack, onNewObs }: Props) {
  const { currentUser } = useUser();
  const sortedObs = useMemo(
    () => [...teacher.observations].sort((a, b) => b.date.localeCompare(a.date)),
    [teacher],
  );

  const recent = sortedObs[0];
  const recentScores = useMemo(() => {
    if (!recent) return [];
    return CATEGORIES.flatMap((c) => c.domains)
      .map((d) => ({ domain: d, score: recent.scores[d.id] as Score | undefined }))
      .filter((x): x is { domain: typeof x.domain; score: Score } => x.score !== undefined);
  }, [recent]);

  const allScores = useMemo(() => {
    return CATEGORIES.flatMap((c) => c.domains).map((d) => {
      const vals = teacher.observations
        .map((o) => o.scores[d.id] as Score | undefined)
        .filter((s): s is Score => s !== undefined);
      const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
      const definedVals = teacher.observations
        .flatMap((o) => (o.scores[d.id] !== undefined ? [o.scores[d.id] as Score] : []));
      const trend = definedVals.length >= 2
        ? definedVals[definedVals.length - 1] - definedVals[0]
        : 0;
      return { domain: d, recentScore: recent?.scores[d.id] as Score | undefined, avg, trend };
    });
  }, [teacher, recent]);

  const overallAvg = recentScores.length
    ? recentScores.reduce((s, { score }) => s + score, 0) / recentScores.length
    : null;

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#F4F6FB", fontFamily: "'Libre Franklin', sans-serif" }}>

      {/* ── Top bar ──────────────────────────────────────── */}
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
                style={{ fontFamily: "'Bebas Neue', sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: "0.02em" }}
              >
                Get Better Faster
              </p>
              <p className="text-blue-200 font-medium truncate" style={{ fontSize: 15 }}>Lincoln Elementary</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 rounded font-semibold text-sm transition-colors"
              style={{ color: "white", backgroundColor: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)" }}
            >
              <ArrowLeft size={15} />
              <span className="hidden sm:inline">Back to Dashboard</span>
            </button>
            <button
              onClick={onNewObs}
              className="flex items-center gap-1.5 font-bold rounded-md px-2.5 sm:px-4 py-2 transition-opacity hover:opacity-90 shadow-sm"
              style={{ backgroundColor: YELLOW, color: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 15, letterSpacing: "0.02em" }}
            >
              <Plus size={16} strokeWidth={3} />
              <span className="hidden sm:inline">Add Observation</span>
            </button>
            <div
              className="flex items-center gap-2 rounded px-2 sm:px-3 py-1.5"
              style={{ backgroundColor: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)" }}
            >
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ backgroundColor: YELLOW, color: NAVY }}>
                {currentUser ? currentUser.name.split(" ").map((w) => w[0]).slice(0, 2).join("") : "…"}
              </div>
              <span className="text-white font-medium hidden sm:block" style={{ fontSize: 15 }}>{currentUser?.name ?? "Loading…"}</span>
              <span className="font-semibold rounded-full px-2.5 py-0.5 hidden md:block" style={{ backgroundColor: YELLOW, color: NAVY, fontSize: 11 }}>
                {currentUser?.role?.replace("_", " ") ?? ""}
              </span>
            </div>
          </div>
        </div>
        <div style={{ height: 3, backgroundColor: YELLOW }} />
      </header>

      {/* ── Page body ─────────────────────────────────────── */}
      <main className="px-3 sm:px-5 py-3 sm:py-5 flex flex-col gap-4 sm:gap-5 flex-1">

        {/* Teacher hero card */}
        <div
          className="rounded-xl overflow-hidden shadow-sm"
          style={{ border: "1px solid #dde3f0" }}
        >
          <div className="px-4 sm:px-6 py-4 sm:py-5" style={{ backgroundColor: NAVY }}>
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <div
                    className="w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-base sm:text-lg font-bold shrink-0"
                    style={{ backgroundColor: YELLOW, color: NAVY, fontFamily: "'Bebas Neue', sans-serif" }}
                  >
                    {teacher.name.split(" ").map((n) => n[0]).join("")}
                  </div>
                  <div>
                    <h1
                      className="text-white font-bold leading-tight"
                      style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 26, letterSpacing: "0.02em" }}
                    >
                      {teacher.name}
                    </h1>
                    <p className="text-blue-200 text-sm font-medium">
                      {teacher.subject} · Grade{teacher.gradeLevel.length !== 1 ? "s" : ""} {teacher.gradeLevel.join(", ")}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex gap-2 sm:gap-3 flex-wrap">
                <div
                  className="text-center rounded-lg px-4 py-2.5 min-w-[80px]"
                  style={{ backgroundColor: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.15)" }}
                >
                  <p className="text-blue-300 text-xs uppercase tracking-wider font-semibold">Current Avg</p>
                  <p
                    className="font-bold mt-0.5"
                    style={{ fontFamily: "'Bebas Neue', sans-serif", fontWeight: 800, fontSize: 30, color: YELLOW, lineHeight: 1 }}
                  >
                    {overallAvg !== null ? overallAvg.toFixed(1) : "—"}
                  </p>
                </div>
                <div
                  className="text-center rounded-lg px-4 py-2.5 min-w-[80px]"
                  style={{ backgroundColor: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.15)" }}
                >
                  <p className="text-blue-300 text-xs uppercase tracking-wider font-semibold">Observations</p>
                  <p
                    className="font-bold text-white mt-0.5"
                    style={{ fontFamily: "'Bebas Neue', sans-serif", fontWeight: 800, fontSize: 30, lineHeight: 1 }}
                  >
                    {teacher.observations.length}
                  </p>
                </div>
                {recent && (() => {
                  const daysSince = Math.floor(
                    (Date.now() - new Date(recent.date + "T00:00:00").getTime()) / 86_400_000
                  );
                  return (
                    <div
                      className="text-center rounded-lg px-4 py-2.5 min-w-[90px]"
                      style={{ backgroundColor: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.15)" }}
                    >
                      <p className="text-blue-300 text-xs uppercase tracking-wider font-semibold">Last Observed</p>
                      <p
                        className="font-bold text-white mt-0.5 leading-none"
                        style={{ fontFamily: "'Bebas Neue', sans-serif", fontWeight: 800, fontSize: 30 }}
                      >
                        {daysSince}
                        <span className="text-base font-semibold ml-0.5">d</span>
                      </p>
                      <p className="text-blue-200 text-xs mt-1">{formatDate(recent.date)}</p>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 sm:gap-5">

          {/* LEFT: Domain score breakdown */}
          <div className="lg:col-span-3 space-y-4">
            <div
              className="bg-white rounded-xl shadow-sm overflow-hidden"
              style={{ border: "1px solid #dde3f0" }}
            >
              <div
                className="px-4 py-3 flex items-center gap-2"
                style={{ borderBottom: `3px solid ${NAVY}`, borderLeft: `4px solid ${YELLOW}` }}
              >
                <BookOpen size={16} style={{ color: NAVY }} />
                <h2
                  className="font-bold uppercase tracking-wide"
                  style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY, fontSize: 18, letterSpacing: "0.02em" }}
                >
                  Domain Scores — Most Recent
                </h2>
              </div>

              <div className="divide-y divide-slate-100">
                {CATEGORIES.map((cat) => (
                  <div key={cat.id}>
                    <div
                      className="px-4 py-2 text-xs font-bold uppercase tracking-wider"
                      style={{ backgroundColor: "#f0f3fc", color: NAVY, fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.02em" }}
                    >
                      {cat.label}
                    </div>
                    {cat.domains.map((d) => {
                      const item = allScores.find((x) => x.domain.id === d.id);
                      if (!item) return null;
                      return (
                        <div key={d.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50 transition-colors">
                          <span className="text-sm font-medium text-slate-700 flex-1">{d.label}</span>
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1 text-xs text-slate-400 w-16 justify-end">
                              {item.trend > 0
                                ? <><TrendingUp size={12} className="text-green-500" /> <span className="text-green-600 font-semibold">+{item.trend}</span></>
                                : item.trend < 0
                                ? <><TrendingDown size={12} className="text-red-400" /> <span className="text-red-500 font-semibold">{item.trend}</span></>
                                : <><Minus size={12} className="text-slate-300" /> <span>flat</span></>}
                            </div>
                            {item.recentScore !== undefined
                              ? <ScoreChip score={item.recentScore} />
                              : <span className="text-xs text-slate-400 italic">not scored</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* RIGHT: Action Steps */}
          <div className="lg:col-span-2 space-y-4">
            {recent && (
              <>
                <div
                  className="bg-white rounded-xl shadow-sm overflow-hidden"
                  style={{ border: "1px solid #dde3f0" }}
                >
                  <div
                    className="px-4 py-3 flex items-center gap-2"
                    style={{ borderBottom: "3px solid #16a34a", borderLeft: `4px solid ${YELLOW}` }}
                  >
                    <Star size={16} className="text-green-600" />
                    <h2
                      className="font-bold uppercase tracking-wide"
                      style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY, fontSize: 18, letterSpacing: "0.02em" }}
                    >
                      ✦ Strengths
                    </h2>
                  </div>
                  <div className="px-4 py-4">
                    {recent.strengths ? (
                      <p className="text-slate-700 leading-relaxed text-sm">{recent.strengths}</p>
                    ) : (
                      <p className="text-slate-400 italic text-sm">No strengths recorded for most recent observation.</p>
                    )}
                    <p className="text-xs text-slate-400 mt-3">From observation on {formatDate(recent.date)}</p>
                  </div>
                </div>

                <div
                  className="bg-white rounded-xl shadow-sm overflow-hidden"
                  style={{ border: "1px solid #dde3f0" }}
                >
                  <div
                    className="px-4 py-3 flex items-center gap-2"
                    style={{ borderBottom: "3px solid #ea580c", borderLeft: `4px solid ${YELLOW}` }}
                  >
                    <CalendarDays size={16} className="text-orange-600" />
                    <h2
                      className="font-bold uppercase tracking-wide"
                      style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY, fontSize: 18, letterSpacing: "0.02em" }}
                    >
                      ↑ Action Steps
                    </h2>
                  </div>
                  <div className="px-4 py-4">
                    {recent.growthAreas ? (
                      <p className="text-slate-700 leading-relaxed text-sm">{recent.growthAreas}</p>
                    ) : (
                      <p className="text-slate-400 italic text-sm">No growth areas recorded for most recent observation.</p>
                    )}
                    <p className="text-xs text-slate-400 mt-3">From observation on {formatDate(recent.date)}</p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Full observation history */}
        <div>
          <h2
            className="font-bold uppercase tracking-wide mb-3"
            style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY, fontSize: 22, letterSpacing: "0.02em" }}
          >
            Observation History
            <span
              className="ml-3 text-base font-semibold rounded-full px-2.5 py-0.5"
              style={{ backgroundColor: YELLOW, color: NAVY }}
            >
              {sortedObs.length}
            </span>
          </h2>
          <div className="space-y-4">
            {sortedObs.map((obs, i) => (
              <ObservationCard key={obs.id} obs={obs} index={i} />
            ))}
          </div>
        </div>

      </main>
    </div>
  );
}
