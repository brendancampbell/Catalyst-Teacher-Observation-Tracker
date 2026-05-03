import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Minus, CalendarDays, BookOpen, Star, Plus } from "lucide-react";
import { type Teacher, type Observation, type Score } from "@/data/dummy";
import { fetchDashboard, updateObservation, type CategoryEntry, type RubricSetRow } from "@/lib/api";
import { getScoreColor, getScoreColorExact } from "@/components/ScoreCell";
import { useUser } from "@/context/UserContext";
import { ObservationDetailModal } from "@/components/ObservationDetailModal";
import AppHeader from "@/components/AppHeader";

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

function ObservationCard({ obs, index, categories, onClick }: { obs: Observation; index: number; categories: CategoryEntry[]; onClick: () => void }) {
  const domains = categories.flatMap((c) => c.domains);
  const scores = domains
    .map((d) => obs.scores[d.id] as Score | undefined)
    .filter((s): s is Score => s !== undefined);
  const avg = scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : null;
  return (
    <div
      className="rounded-xl border overflow-hidden cursor-pointer group transition-shadow hover:shadow-md"
      style={{ borderColor: index === 0 ? YELLOW : "#e2e8f0", boxShadow: index === 0 ? `0 0 0 1.5px ${YELLOW}` : undefined }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(); }}
      aria-label={`View observation from ${obs.date}`}
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
        {categories.map((cat) => (
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
  rubricSets: RubricSetRow[];
  initialRubricSet: string;
  initialCategories: CategoryEntry[];
  schoolId?: number | null;
}

export function TeacherProfile({ teacher, onBack, onNewObs, rubricSets, initialRubricSet, initialCategories, schoolId }: Props) {
  const { currentUser } = useUser();

  /* ── Role-based edit permission ───────────────────────────────── */
  const canEdit =
    currentUser?.role === "SCHOOL_LEADER" ||
    currentUser?.role === "NETWORK_LEADER" ||
    currentUser?.role === "NETWORK_ADMIN";

  /* ── Observation modal state ──────────────────────────────────── */
  const [selectedObservation, setSelectedObservation] = useState<Observation | null>(null);
  const [localObsOverrides, setLocalObsOverrides] = useState<Record<string, Observation>>({});

  /* ── Rubric switching ─────────────────────────────────────────── */
  const [selectedRubricSlug, setSelectedRubricSlug] = useState(initialRubricSet);

  const isInitialRubric = selectedRubricSlug === initialRubricSet;

  const { data: altData, isFetching: altFetching } = useQuery({
    queryKey: ["dashboard", selectedRubricSlug, schoolId ?? null],
    queryFn: () => fetchDashboard(selectedRubricSlug, schoolId ?? null),
    enabled: !isInitialRubric,
    staleTime: 60_000,
  });

  const activeCategories: CategoryEntry[] = isInitialRubric
    ? initialCategories
    : (altData?.categories ?? initialCategories);

  const activeTeacher: Teacher = isInitialRubric
    ? teacher
    : (altData?.teachers.find((t) => t.id === teacher.id) ?? teacher);

  const sortedObs = useMemo(
    () =>
      [...activeTeacher.observations]
        .map((o) => localObsOverrides[o.id] ?? o)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [activeTeacher, localObsOverrides],
  );

  const recent = sortedObs[0];
  const recentScores = useMemo(() => {
    if (!recent) return [];
    return activeCategories.flatMap((c) => c.domains)
      .map((d) => ({ domain: d, score: recent.scores[d.id] as Score | undefined }))
      .filter((x): x is { domain: typeof x.domain; score: Score } => x.score !== undefined);
  }, [recent, activeCategories]);

  const allScores = useMemo(() => {
    return activeCategories.flatMap((c) => c.domains).map((d) => {
      const vals = activeTeacher.observations
        .map((o) => o.scores[d.id] as Score | undefined)
        .filter((s): s is Score => s !== undefined);
      const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
      const definedVals = activeTeacher.observations
        .flatMap((o) => (o.scores[d.id] !== undefined ? [o.scores[d.id] as Score] : []));
      const trend = definedVals.length >= 2
        ? definedVals[definedVals.length - 1] - definedVals[0]
        : 0;
      return { domain: d, recentScore: recent?.scores[d.id] as Score | undefined, avg, trend };
    });
  }, [activeTeacher, activeCategories, recent]);

  const overallAvg = recentScores.length
    ? recentScores.reduce((s, { score }) => s + score, 0) / recentScores.length
    : null;

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const backHref = (() => {
    const params = new URLSearchParams(window.location.search);
    params.delete("teacher");
    const qs = params.toString();
    return window.location.pathname + (qs ? "?" + qs : "");
  })();
  const schoolDisplayName =
    new URLSearchParams(window.location.search).get("schoolName") ??
    currentUser?.schoolName ?? "";

  return (
    <div className="h-full overflow-y-auto flex flex-col" style={{ backgroundColor: "#F4F6FB", fontFamily: "'Libre Franklin', sans-serif" }}>

      {/* ── Top bar ──────────────────────────────────────── */}
      <div className="sticky top-0 z-30 shadow-md">
        {currentUser && (
          <AppHeader
            subtitle={teacher.name}
            backHref={backHref}
            backLabel={schoolDisplayName || "Dashboard"}
            basePath={basePath}
            onAddObservation={onNewObs}
            actionCenterHref={`${basePath}/action-center?returnTo=${encodeURIComponent(backHref)}`}
            userName={currentUser.name}
            userEmail={currentUser.email}
            userRole={currentUser.role}
            canAdmin={currentUser.role !== "COACH"}
          />
        )}
      </div>

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
                    {teacher.email && (
                      <a
                        href={`mailto:${teacher.email}`}
                        className="text-xs font-medium mt-0.5 hover:text-white transition-colors"
                        style={{ color: "rgba(147,197,253,0.85)", textDecoration: "none" }}
                      >
                        {teacher.email}
                      </a>
                    )}
                  </div>
                </div>

                {/* ── Rubric selector ─── */}
                {rubricSets.length > 1 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {rubricSets.map((rs) => {
                      const isActive = rs.slug === selectedRubricSlug;
                      return (
                        <button
                          key={rs.slug}
                          onClick={() => setSelectedRubricSlug(rs.slug)}
                          className="px-3 py-1 rounded-full transition-all"
                          style={{
                            fontFamily: "'Bebas Neue', sans-serif",
                            fontSize: 13,
                            letterSpacing: "0.04em",
                            fontWeight: 700,
                            backgroundColor: isActive ? YELLOW : "rgba(255,255,255,0.12)",
                            color: isActive ? NAVY : "rgba(255,255,255,0.85)",
                            border: isActive ? "none" : "1px solid rgba(255,255,255,0.2)",
                            opacity: altFetching && !isActive ? 0.5 : 1,
                          }}
                        >
                          {rs.name}
                        </button>
                      );
                    })}
                  </div>
                )}
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
                    {activeTeacher.observations.length}
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
                {activeCategories.map((cat) => (
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
              <ObservationCard
                key={obs.id}
                obs={obs}
                index={i}
                categories={activeCategories}
                onClick={() => setSelectedObservation(obs)}
              />
            ))}
          </div>
        </div>

      </main>

      {/* ── Observation detail modal ──────────────────────── */}
      {selectedObservation && (
        <ObservationDetailModal
          teacher={activeTeacher}
          observation={localObsOverrides[selectedObservation.id] ?? selectedObservation}
          categories={activeCategories}
          canEdit={canEdit}
          open={!!selectedObservation}
          onOpenChange={(open) => { if (!open) setSelectedObservation(null); }}
          onSave={async (updated) => {
            const saved = await updateObservation(updated.id, {
              strengths:   updated.strengths,
              growthAreas: updated.growthAreas,
              scores:      updated.scores,
            });
            setLocalObsOverrides((prev) => ({ ...prev, [saved.id]: saved }));
            setSelectedObservation(saved);
          }}
        />
      )}
    </div>
  );
}
