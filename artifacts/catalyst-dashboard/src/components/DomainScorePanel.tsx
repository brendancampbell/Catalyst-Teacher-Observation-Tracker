import { BookOpen, TrendingUp, TrendingDown, Minus, Star, CalendarDays } from "lucide-react";
import { getScoreColorExact } from "@/components/ScoreCell";
import { RichTextDisplay } from "@/components/RichTextDisplay";
import type { Observation, CategoryEntry, DomainEntry } from "@workspace/api-types";
import { type Score } from "@/data/dummy";

const NAVY   = "#1034B4";
const YELLOW = "#FFB500";

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });
}

const SCORE_LABELS: Record<number, string> = {
  0:   "Not Yet",
  0.5: "Developing",
  1:   "Proficient",
};

function ScoreChip({ score }: { score: Score }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded font-bold text-sm ${getScoreColorExact(score)}`}>
      {score} <span className="font-normal text-xs opacity-80">{SCORE_LABELS[score]}</span>
    </span>
  );
}

export interface DomainScoreRow {
  domain:      DomainEntry;
  recentScore: Score | undefined;
  avg:         number | null;
  trend:       number;
}

/**
 * Each domain's most recent score, and which way it has moved.
 *
 * The trend compares the earliest recorded score to the latest, so it answers
 * "has this got better since we started looking" rather than "did it move
 * since last time" — a single bad day should not read as a decline.
 *
 * Shared because two histories show it now: a teacher's, and a school's for
 * school-wide observations. The arithmetic is the same either way.
 */
export function domainScoreRows(
  categories:   CategoryEntry[],
  observations: Observation[],
): DomainScoreRow[] {
  const recent = [...observations].sort((a, b) => b.date.localeCompare(a.date))[0];
  return categories.flatMap((c) => c.domains).map((d: DomainEntry) => {
    const vals = observations
      .map((o) => o.scores[d.id] as Score | undefined)
      .filter((s): s is Score => s !== undefined);
    const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    const definedVals = [...observations]
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .flatMap((o) => (o.scores[d.id] !== undefined ? [o.scores[d.id] as Score] : []));
    const trend = definedVals.length >= 2
      ? definedVals[definedVals.length - 1]! - definedVals[0]!
      : 0;
    return { domain: d, recentScore: recent?.scores[d.id] as Score | undefined, avg, trend };
  });
}

export function DomainScorePanel({
  categories, allScores,
}: { categories: CategoryEntry[]; allScores: DomainScoreRow[] }) {
  return (
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
                {categories.map((cat: CategoryEntry) => (
                  <div key={cat.id}>
                    <div
                      className="px-4 py-2 text-xs font-bold uppercase tracking-wider"
                      style={{ backgroundColor: "#f0f3fc", color: NAVY, fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.02em" }}
                    >
                      {cat.label}
                    </div>
                    {cat.domains.map((d: DomainEntry) => {
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
  );
}

/** The glows and grows from the most recent observation. */
export function RecentFeedbackCards({ recent }: { recent: Observation }) {
  return (
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
                      style={{ fontFamily: "'Bebas Neue', sans-serif", color: "#16a34a", fontSize: 18, letterSpacing: "0.02em" }}
                    >
                      ✦ Teacher Strengths (Glows)
                    </h2>
                  </div>
                  <div className="px-4 py-4">
                    <RichTextDisplay
                      content={recent.strengths}
                      className="text-slate-700"
                      emptyNode={<p className="text-slate-400 italic text-sm">No strengths recorded for most recent observation.</p>}
                    />
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
                      style={{ fontFamily: "'Bebas Neue', sans-serif", color: "#ea580c", fontSize: 18, letterSpacing: "0.02em" }}
                    >
                      ↑ Growth Areas (Grows)
                    </h2>
                  </div>
                  <div className="px-4 py-4">
                    <RichTextDisplay
                      content={recent.growthAreas}
                      className="text-slate-700"
                      emptyNode={<p className="text-slate-400 italic text-sm">No growth areas recorded for most recent observation.</p>}
                    />
                    <p className="text-xs text-slate-400 mt-3">From observation on {formatDate(recent.date)}</p>
                  </div>
                </div>
    </>
  );
}
