import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { type Teacher } from "@/data/dummy";
import { getScoreColorExact } from "@/components/ScoreCell";

const NAVY = "#1034B4";
const YELLOW = "#FFB500";

interface Props {
  teacher: Teacher | null;
  domainId: string | null;
  domainLabel: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function TrendIcon({ prev, curr }: { prev: number; curr: number }) {
  if (curr > prev) return <TrendingUp size={14} className="text-green-600" />;
  if (curr < prev) return <TrendingDown size={14} className="text-red-500" />;
  return <Minus size={14} className="text-slate-400" />;
}

export function DrillDownModal({ teacher, domainId, domainLabel, open, onOpenChange }: Props) {
  if (!teacher || !domainId || !domainLabel) return null;

  const history = [...teacher.observations]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((obs, i, arr) => ({
      date: obs.date,
      score: obs.scores[domainId] as number | undefined,
      strengths: obs.strengths,
      growthAreas: obs.growthAreas,
      prevScore: arr[i + 1]?.scores[domainId] as number | undefined,
    }));

  const scores = history.map((h) => h.score).filter((s): s is number => s !== undefined);
  const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

  function formatDate(iso: string) {
    return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-xl max-h-[88vh] flex flex-col bg-white rounded-xl shadow-2xl overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">

          {/* ── Header ───────────────────────────────────── */}
          <div className="shrink-0 px-6 py-4" style={{ backgroundColor: NAVY }}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <DialogPrimitive.Title
                  className="text-white font-bold leading-tight"
                  style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 22, letterSpacing: "0.05em" }}
                >
                  {teacher.name}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-blue-200 text-sm mt-0.5 font-medium">
                  {domainLabel} · Score Progression
                </DialogPrimitive.Description>
              </div>
              <DialogPrimitive.Close className="text-blue-300 hover:text-white transition-colors rounded p-1 mt-0.5">
                <X size={20} />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            </div>

            {/* Quick stats strip */}
            <div className="flex items-center gap-5 mt-3 pt-3 border-t border-blue-800">
              <div>
                <p className="text-blue-300 text-xs uppercase tracking-wider font-semibold">Observations</p>
                <p className="text-white font-bold text-lg" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
                  {history.length}
                </p>
              </div>
              {avgScore !== null && (
                <div>
                  <p className="text-blue-300 text-xs uppercase tracking-wider font-semibold">Avg Score</p>
                  <p className="font-bold text-lg" style={{ fontFamily: "'Barlow Condensed', sans-serif", color: YELLOW }}>
                    {avgScore.toFixed(1)}
                  </p>
                </div>
              )}
              {scores.length >= 2 && (
                <div>
                  <p className="text-blue-300 text-xs uppercase tracking-wider font-semibold">Trend</p>
                  <p className="text-white font-bold text-lg flex items-center gap-1" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
                    {scores[0] > scores[scores.length - 1] ? (
                      <><TrendingUp size={16} className="text-green-400" /> +{(scores[0] - scores[scores.length - 1]).toFixed(0)}</>
                    ) : scores[0] < scores[scores.length - 1] ? (
                      <><TrendingDown size={16} className="text-red-400" /> {(scores[0] - scores[scores.length - 1]).toFixed(0)}</>
                    ) : (
                      <><Minus size={16} className="text-slate-400" /> Flat</>
                    )}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ── Score timeline bar ────────────────────────── */}
          {scores.length >= 2 && (
            <div className="shrink-0 px-6 py-3 bg-slate-50 border-b border-slate-200">
              <div className="flex items-end gap-1.5 h-10">
                {[...history].reverse().map((h, i) => {
                  const s = h.score ?? 0;
                  const heightPct = (s / 4) * 100;
                  const colorMap: Record<number, string> = { 4: "#15803d", 3: "#86efac", 2: "#fef08a", 1: "#fca5a5" };
                  return (
                    <div key={i} className="flex flex-col items-center gap-1 flex-1">
                      <div
                        className="w-full rounded-sm transition-all"
                        style={{ height: `${heightPct}%`, backgroundColor: colorMap[s] ?? "#e2e8f0", minHeight: 4 }}
                        title={`${formatDate(h.date)}: ${s}`}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-xs text-slate-400">Oldest</span>
                <span className="text-xs text-slate-400">Most Recent</span>
              </div>
            </div>
          )}

          {/* ── Observation history ───────────────────────── */}
          <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3" style={{ fontFamily: "'Libre Franklin', sans-serif" }}>
            {history.map((h, i) => (
              <div key={h.date} className="rounded-lg border border-slate-200 overflow-hidden">

                {/* Row header */}
                <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    {i === 0 && (
                      <span
                        className="text-xs font-bold uppercase tracking-wide rounded px-2 py-0.5"
                        style={{ backgroundColor: YELLOW, color: NAVY }}
                      >
                        Most Recent
                      </span>
                    )}
                    <span className="font-semibold text-slate-700 text-sm">{formatDate(h.date)}</span>
                    {h.prevScore !== undefined && h.score !== undefined && (
                      <span className="flex items-center gap-0.5 text-xs text-slate-500">
                        <TrendIcon prev={h.prevScore} curr={h.score} />
                        {h.score > h.prevScore ? `+${h.score - h.prevScore}` : h.score < h.prevScore ? `${h.score - h.prevScore}` : "No change"}
                      </span>
                    )}
                  </div>
                  {h.score !== undefined && (
                    <span className={`text-sm font-bold px-3 py-1 rounded ${getScoreColorExact(h.score as 1 | 2 | 3 | 4)}`}>
                      {h.score}
                    </span>
                  )}
                </div>

                {/* Notes — these are full-observation notes, not domain-specific */}
                {h.strengths || h.growthAreas ? (
                  <div className="px-4 pb-3 pt-2">
                    <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold mb-2">
                      Observation Notes (full visit)
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: "#16a34a" }}>
                          Strengths
                        </p>
                        <p className="text-sm text-slate-600 leading-relaxed">
                          {h.strengths || <span className="text-slate-300 italic">None recorded</span>}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: "#ea580c" }}>
                          Growth Areas
                        </p>
                        <p className="text-sm text-slate-600 leading-relaxed">
                          {h.growthAreas || <span className="text-slate-300 italic">None recorded</span>}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="px-4 py-3">
                    <p className="text-sm text-slate-400 italic">No observation notes recorded.</p>
                  </div>
                )}
              </div>
            ))}
          </div>

        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
