import { useState, useMemo } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X, TrendingUp, TrendingDown, Minus } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { type Teacher, type Observation } from "@/data/dummy";
import { updateObservation, deleteObservation, type CategoryEntry } from "@/lib/api";
import { ObservationDetailModal } from "@/components/ObservationDetailModal";

const NAVY = "#1034B4";
const YELLOW = "#FFB500";

/* ── 0 / 0.5 / 1.0 helpers ──────────────────────────────── */
function getScoreLabel(score: number): string {
  if (score >= 1)   return "Proficient";
  if (score >= 0.5) return "Approaching";
  return "Not Yet";
}

function getDotColor(score: number): string {
  if (score >= 0.7) return "#15803d";  // green-700
  if (score >= 0.5) return "#d97706";  // amber-600
  return "#ef4444";                    // red-500
}

/* ── Custom tooltip shown on hover ──────────────── */
function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartPoint }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const score = d.score;
  if (score === null || score === undefined) return null;

  const color = getDotColor(score);

  return (
    <div
      className="bg-white rounded-xl shadow-xl border border-slate-200 p-3.5 text-sm"
      style={{ minWidth: 220, fontFamily: "'Libre Franklin', sans-serif" }}
    >
      <p className="font-bold text-slate-800">{d.dateLabel}</p>
      <div className="flex items-center gap-2 mt-2">
        <span
          className="font-bold text-base px-2.5 py-0.5 rounded"
          style={{ backgroundColor: color + "22", color, border: `1.5px solid ${color}`, fontFamily: "'Bebas Neue', sans-serif", fontSize: 18 }}
        >
          {score.toFixed(1)}
        </span>
        <span className="text-slate-600">
          {getScoreLabel(score)}{d.count > 1 ? " (avg)" : ""}
        </span>
      </div>
      {d.count > 1 ? (
        <p className="text-slate-500 text-xs mt-2">
          <span className="font-semibold text-slate-700">{d.count} observations</span> on this date
        </p>
      ) : (
        <p className="text-slate-500 text-xs mt-2">
          Observed by <span className="font-semibold text-slate-700">{d.observer}</span>
        </p>
      )}
      <p className="text-blue-500 text-xs mt-2 border-t border-slate-100 pt-2">
        {d.count > 1 ? "Click to see individual observations →" : "Click to open full observation →"}
      </p>
    </div>
  );
}

/* ── Custom dot rendered on line ─────────────────── */
function CustomDot(props: { cx?: number; cy?: number; payload?: ChartPoint }) {
  const { cx, cy, payload } = props;
  if (!cx || !cy || payload?.score === null || payload?.score === undefined) return null;
  const color = getDotColor(payload.score);

  return (
    <g style={{ pointerEvents: "none" }}>
      <circle cx={cx} cy={cy} r={13} fill={color} opacity={0.12} />
      <circle cx={cx} cy={cy} r={8} fill="white" stroke={color} strokeWidth={2.5} />
      <circle cx={cx} cy={cy} r={5} fill={color} />
    </g>
  );
}

/* ── Stat card in header ──────────────────────────── */
function StatCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col rounded-lg px-4 py-2.5 min-w-[90px]"
      style={{ backgroundColor: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)" }}
    >
      <span className="text-blue-300 text-xs uppercase tracking-wider font-semibold mb-0.5">{label}</span>
      <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontWeight: 800, fontSize: 28, lineHeight: 1 }}>
        {children}
      </span>
    </div>
  );
}

interface ChartPoint {
  date: string;
  dateLabel: string;
  timestamp: number;
  score: number | null;    // averaged when count > 1
  observer: string;        // first observer name; comma-joined for multi
  obsIds: string[];        // all observation IDs on this date
  count: number;           // number of observations on this date
}

interface Props {
  teacher: Teacher | null;
  domainId: string | null;
  domainLabel: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdateObs: (teacherId: string, updated: Observation) => void;
  onDeleteObs: (teacherId: string, observationId: string) => void;
  onTeacherClick?: () => void;
  categories: CategoryEntry[];
  canEdit: boolean;
}

export function DrillDownModal({ teacher, domainId, domainLabel, open, onOpenChange, onUpdateObs, onDeleteObs, onTeacherClick, categories, canEdit }: Props) {
  const [detailObsId, setDetailObsId] = useState<string | null>(null);
  const [pendingGroup, setPendingGroup] = useState<ChartPoint | null>(null);

  const chartData = useMemo<ChartPoint[]>(() => {
    if (!teacher || !domainId) return [];

    // Group observations by date
    const byDate = new Map<string, typeof teacher.observations>();
    for (const obs of teacher.observations) {
      if (!byDate.has(obs.date)) byDate.set(obs.date, []);
      byDate.get(obs.date)!.push(obs);
    }

    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, group]) => {
        const dt = new Date(date + "T00:00:00");
        const domainScores = group
          .map((o) => o.scores[domainId] as number | undefined)
          .filter((s): s is number => s !== undefined);
        const avgScore = domainScores.length
          ? domainScores.reduce((a, b) => a + b, 0) / domainScores.length
          : null;
        return {
          date,
          dateLabel: dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
          timestamp: dt.getTime(),
          score: avgScore,
          observer: group.map((o) => o.observer).join(", "),
          obsIds: group.map((o) => o.id),
          count: group.length,
        };
      });
  }, [teacher, domainId]);

  const totalObsCount = chartData.reduce((sum, p) => sum + p.count, 0);

  const detailObs = useMemo(
    () => (detailObsId && teacher ? teacher.observations.find((o) => o.id === detailObsId) ?? null : null),
    [detailObsId, teacher],
  );

  if (!teacher || !domainId || !domainLabel) return null;

  const scores = chartData.map((d) => d.score).filter((s): s is number => s !== null);
  const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const firstScore = scores[0];
  const lastScore = scores[scores.length - 1];
  const trendDelta = scores.length >= 2 ? lastScore - firstScore : null;

  // X-axis domain: add 5-day padding on each side
  const timestamps = chartData.map((d) => d.timestamp);
  const minTs = Math.min(...timestamps) - 5 * 86_400_000;
  const maxTs = Math.max(...timestamps) + 5 * 86_400_000;

  function handleChartClick(data: { activePayload?: Array<{ payload: ChartPoint }> } | null) {
    if (!data?.activePayload?.[0]) return;
    const point = data.activePayload[0].payload;
    if (point.count === 1) {
      setDetailObsId(point.obsIds[0]);
      setPendingGroup(null);
    } else {
      setPendingGroup(point);
      setDetailObsId(null);
    }
  }

  async function handleSave(updated: Observation) {
    const saved = await updateObservation(updated.id, {
      strengths:   updated.strengths,
      growthAreas: updated.growthAreas,
      scores:      updated.scores,
    });
    onUpdateObs(teacher!.id, saved);
  }

  async function handleDelete(observationId: string) {
    await deleteObservation(observationId);
    onDeleteObs(teacher!.id, observationId);
    setDetailObsId(null);
  }

  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content className="fixed z-50 flex flex-col bg-white shadow-2xl overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 inset-x-2 inset-y-3 rounded-xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-full sm:max-w-2xl sm:max-h-[88vh]">

            {/* ── Header ───────────────────────────────── */}
            <div className="shrink-0 px-6 pt-4 pb-5" style={{ backgroundColor: NAVY }}>
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <DialogPrimitive.Title
                    className="leading-tight"
                    style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: "0.02em" }}
                  >
                    {onTeacherClick ? (
                      <button
                        onClick={() => { onOpenChange(false); onTeacherClick(); }}
                        className="text-white hover:text-yellow-300 transition-colors underline underline-offset-2 decoration-yellow-400/60 hover:decoration-yellow-300 font-bold"
                        style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 24, letterSpacing: "0.02em", background: "none", border: "none", padding: 0, cursor: "pointer" }}
                      >
                        {teacher.name}
                      </button>
                    ) : (
                      <span className="text-white font-bold">{teacher.name}</span>
                    )}
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Description className="text-blue-200 text-sm mt-0.5 font-medium">
                    {domainLabel} · Score Progression
                  </DialogPrimitive.Description>
                </div>
                <DialogPrimitive.Close className="text-blue-300 hover:text-white transition-colors rounded p-1 mt-0.5 shrink-0">
                  <X size={20} />
                  <span className="sr-only">Close</span>
                </DialogPrimitive.Close>
              </div>

              {/* ── Stat cards ─────────────────────────── */}
              <div className="flex items-stretch gap-3 flex-wrap">
                <StatCard label="Observations">
                  <span className="text-white">{totalObsCount}</span>
                </StatCard>

                {avgScore !== null && (
                  <StatCard label="Avg Score">
                    <span style={{ color: YELLOW }}>{avgScore.toFixed(1)}</span>
                  </StatCard>
                )}

                {trendDelta !== null && (
                  <StatCard label="Overall Trend">
                    <span
                      className="flex items-center gap-1"
                      style={{ color: trendDelta > 0 ? "#4ade80" : trendDelta < 0 ? "#f87171" : "#94a3b8" }}
                    >
                      {trendDelta > 0 ? <TrendingUp size={20} /> : trendDelta < 0 ? <TrendingDown size={20} /> : <Minus size={20} />}
                      {trendDelta > 0 ? `+${trendDelta.toFixed(1)}` : trendDelta === 0 ? "Flat" : trendDelta.toFixed(1)}
                    </span>
                  </StatCard>
                )}

                <StatCard label="Current Score">
                  <span
                    style={{
                      color: lastScore !== undefined
                        ? getDotColor(lastScore)
                        : "#94a3b8",
                    }}
                  >
                    {lastScore !== undefined ? lastScore.toFixed(1) : "—"}
                  </span>
                </StatCard>
              </div>
            </div>

            {/* ── Line Chart ───────────────────────────── */}
            <div className="shrink-0 px-4 pt-4 pb-3 bg-white" style={{ fontFamily: "'Libre Franklin', sans-serif" }}>
              <p className="text-xs text-slate-400 text-center mb-3 uppercase tracking-wider font-semibold">
                Hover a dot to see observer · Click to open full observation
              </p>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart
                  data={chartData}
                  margin={{ top: 8, right: 24, left: 8, bottom: 4 }}
                  onClick={handleChartClick}
                  style={{ cursor: "pointer" }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    type="number"
                    scale="time"
                    dataKey="timestamp"
                    domain={[minTs, maxTs]}
                    tickFormatter={(ts: number) =>
                      new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                    }
                    tick={{ fontSize: 11, fill: "#64748b", fontFamily: "'Libre Franklin', sans-serif" }}
                    axisLine={{ stroke: "#e2e8f0" }}
                    tickLine={false}
                    tickCount={Math.min(chartData.length + 2, 8)}
                  />
                  <YAxis
                    domain={[-0.1, 1.15]}
                    ticks={[0, 0.5, 1]}
                    tick={{ fontSize: 11, fill: "#64748b", fontFamily: "'Libre Franklin', sans-serif" }}
                    tickFormatter={(v) => v.toFixed(1)}
                    axisLine={false}
                    tickLine={false}
                    width={30}
                  />
                  <Tooltip
                    content={<ChartTooltip />}
                    cursor={{ stroke: "#dde3f0", strokeWidth: 1.5, strokeDasharray: "4 2" }}
                  />
                  <ReferenceLine
                    y={0.7}
                    stroke="#16a34a"
                    strokeDasharray="5 3"
                    strokeWidth={1.5}
                    opacity={0.6}
                    label={{ value: "Proficient (0.7)", position: "insideTopRight", fontSize: 10, fill: "#16a34a", dy: -6 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke={NAVY}
                    strokeWidth={2.5}
                    dot={(dotProps: any) => <CustomDot key={dotProps.index} {...dotProps} />}
                    activeDot={{ r: 11, fill: NAVY, stroke: "white", strokeWidth: 2.5 }}
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>

              {/* Score level legend */}
              <div className="flex justify-center flex-wrap gap-4 mt-2">
                {([1, 0.5, 0] as const).map((s) => (
                  <div key={s} className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full inline-block shrink-0" style={{ backgroundColor: getDotColor(s) }} />
                    <span className="text-xs text-slate-500">
                      {s.toFixed(1)}
                      <span className="hidden sm:inline"> · {getScoreLabel(s)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Same-day observations picker ─────────────────── */}
            {pendingGroup && teacher && (
              <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-5 py-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    {pendingGroup.count} Observations on {pendingGroup.dateLabel} — select one to view
                  </p>
                  <button
                    type="button"
                    onClick={() => setPendingGroup(null)}
                    className="text-slate-400 hover:text-slate-600 transition-colors text-xs font-semibold"
                  >
                    ✕ Clear
                  </button>
                </div>
                <div className="space-y-2">
                  {pendingGroup.obsIds.map((obsId) => {
                    const obs = teacher.observations.find((o) => o.id === obsId);
                    if (!obs) return null;
                    const domScore = obs.scores[domainId!] as number | undefined;
                    const color = domScore !== undefined ? getDotColor(domScore) : "#94a3b8";
                    return (
                      <button
                        key={obsId}
                        type="button"
                        onClick={() => { setDetailObsId(obsId); setPendingGroup(null); }}
                        className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-slate-200 bg-white hover:bg-blue-50 hover:border-blue-200 transition-colors text-left"
                      >
                        <div>
                          <p className="text-sm font-semibold text-slate-700">{obs.observer}</p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {obs.isWalkthrough ? "Walkthrough" : "Full Observation"}
                            {obs.time ? ` · ${obs.time}` : ""}
                          </p>
                        </div>
                        {domScore !== undefined ? (
                          <div className="flex items-center gap-3 shrink-0">
                            <span
                              className="font-bold px-2.5 py-0.5 rounded"
                              style={{ backgroundColor: color + "22", color, border: `1.5px solid ${color}`, fontFamily: "'Bebas Neue', sans-serif", fontSize: 20 }}
                            >
                              {domScore.toFixed(1)}
                            </span>
                            <span className="text-xs text-blue-600 font-semibold">View →</span>
                          </div>
                        ) : (
                          <span className="text-xs text-blue-600 font-semibold shrink-0">View →</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      {/* Nested: full observation detail */}
      {detailObs && (
        <ObservationDetailModal
          teacher={teacher}
          observation={detailObs}
          categories={categories}
          canEdit={canEdit}
          open={detailObsId !== null}
          onOpenChange={(o) => { if (!o) setDetailObsId(null); }}
          onSave={handleSave}
          onDelete={canEdit ? handleDelete : undefined}
        />
      )}
    </>
  );
}
