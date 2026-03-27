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
import { ObservationDetailModal } from "@/components/ObservationDetailModal";

const NAVY = "#1034B4";
const YELLOW = "#FFB500";

const SCORE_LABELS: Record<number, string> = {
  1: "Needs Improvement",
  2: "Approaching",
  3: "Proficient",
  4: "Exemplary",
};

const DOT_COLORS: Record<number, string> = {
  4: "#15803d",
  3: "#22c55e",
  2: "#eab308",
  1: "#ef4444",
};

/* ── Custom tooltip shown on hover ──────────────── */
function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartPoint }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const score = d.score;
  if (!score) return null;

  return (
    <div
      className="bg-white rounded-xl shadow-xl border border-slate-200 p-3.5 text-sm"
      style={{ minWidth: 210, fontFamily: "'Libre Franklin', sans-serif" }}
    >
      <p className="font-bold text-slate-800 text-sm">{d.dateLabel}</p>
      <div className="flex items-center gap-2 mt-2">
        <span
          className="font-bold text-base px-2.5 py-0.5 rounded"
          style={{ backgroundColor: DOT_COLORS[score] + "22", color: DOT_COLORS[score], border: `1.5px solid ${DOT_COLORS[score]}` }}
        >
          {score}
        </span>
        <span className="text-slate-600">{SCORE_LABELS[score]}</span>
      </div>
      <p className="text-slate-500 text-xs mt-2">
        Observed by <span className="font-semibold text-slate-700">{d.observer}</span>
      </p>
      <p className="text-blue-500 text-xs mt-2 border-t border-slate-100 pt-2">
        Click dot to open full observation →
      </p>
    </div>
  );
}

/* ── Custom dot rendered on line ─────────────────── */
function CustomDot(props: {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: ChartPoint;
}) {
  const { cx, cy, payload } = props;
  if (!cx || !cy || !payload?.score) return null;
  const color = DOT_COLORS[payload.score] ?? "#94a3b8";

  return (
    <g style={{ pointerEvents: "none" }}>
      <circle cx={cx} cy={cy} r={13} fill={color} opacity={0.12} />
      <circle cx={cx} cy={cy} r={8} fill="white" stroke={color} strokeWidth={2.5} />
      <circle cx={cx} cy={cy} r={5} fill={color} />
    </g>
  );
}

interface ChartPoint {
  date: string;
  dateLabel: string;
  score: number | null;
  observer: string;
  obsId: string;
}

interface Props {
  teacher: Teacher | null;
  domainId: string | null;
  domainLabel: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdateObs: (teacherId: string, updated: Observation) => void;
}

export function DrillDownModal({ teacher, domainId, domainLabel, open, onOpenChange, onUpdateObs }: Props) {
  const [detailObsId, setDetailObsId] = useState<string | null>(null);

  const chartData = useMemo<ChartPoint[]>(() => {
    if (!teacher || !domainId) return [];
    return [...teacher.observations]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((obs) => ({
        date: obs.date,
        dateLabel: new Date(obs.date + "T00:00:00").toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "2-digit",
        }),
        score: (obs.scores[domainId] as number) ?? null,
        observer: obs.observer,
        obsId: obs.id,
      }));
  }, [teacher, domainId]);

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

  function handleChartClick(data: { activePayload?: Array<{ payload: ChartPoint }> } | null) {
    if (data?.activePayload?.[0]) {
      setDetailObsId(data.activePayload[0].payload.obsId);
    }
  }

  function handleSave(updated: Observation) {
    onUpdateObs(teacher!.id, updated);
  }

  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-2xl max-h-[88vh] flex flex-col bg-white rounded-xl shadow-2xl overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">

            {/* ── Header ───────────────────────────────── */}
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
                <DialogPrimitive.Close className="text-blue-300 hover:text-white transition-colors rounded p-1 mt-0.5 shrink-0">
                  <X size={20} />
                  <span className="sr-only">Close</span>
                </DialogPrimitive.Close>
              </div>

              {/* Stats strip */}
              <div className="flex items-center gap-6 mt-3 pt-3 border-t border-blue-800">
                <div>
                  <p className="text-blue-300 text-xs uppercase tracking-wider font-semibold">Observations</p>
                  <p className="text-white font-bold text-lg" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
                    {chartData.length}
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
                {trendDelta !== null && (
                  <div>
                    <p className="text-blue-300 text-xs uppercase tracking-wider font-semibold">Overall Trend</p>
                    <p
                      className="font-bold text-lg flex items-center gap-1"
                      style={{ fontFamily: "'Barlow Condensed', sans-serif", color: trendDelta > 0 ? "#4ade80" : trendDelta < 0 ? "#f87171" : "#94a3b8" }}
                    >
                      {trendDelta > 0 ? <TrendingUp size={16} /> : trendDelta < 0 ? <TrendingDown size={16} /> : <Minus size={16} />}
                      {trendDelta > 0 ? `+${trendDelta}` : trendDelta === 0 ? "Flat" : trendDelta}
                    </p>
                  </div>
                )}
                <div className="ml-auto text-right">
                  <p className="text-blue-300 text-xs uppercase tracking-wider font-semibold">Latest</p>
                  <p className="text-white font-bold text-lg" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
                    {lastScore ?? "—"}
                  </p>
                </div>
              </div>
            </div>

            {/* ── Line Chart ───────────────────────────── */}
            <div className="shrink-0 px-4 pt-5 pb-3 bg-white" style={{ fontFamily: "'Libre Franklin', sans-serif" }}>
              <p className="text-xs text-slate-400 text-center mb-3 uppercase tracking-wider font-semibold">
                Hover a dot to see observer · Click to open full observation
              </p>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart
                  data={chartData}
                  margin={{ top: 8, right: 24, left: 8, bottom: 4 }}
                  onClick={handleChartClick}
                  style={{ cursor: "pointer" }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="dateLabel"
                    tick={{ fontSize: 11, fill: "#64748b", fontFamily: "'Libre Franklin', sans-serif" }}
                    axisLine={{ stroke: "#e2e8f0" }}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[1, 4]}
                    ticks={[1, 2, 3, 4]}
                    tick={{ fontSize: 11, fill: "#64748b", fontFamily: "'Libre Franklin', sans-serif" }}
                    tickFormatter={(v) => `${v}`}
                    axisLine={false}
                    tickLine={false}
                    width={24}
                  />
                  <Tooltip
                    content={<ChartTooltip />}
                    cursor={{ stroke: "#dde3f0", strokeWidth: 1.5, strokeDasharray: "4 2" }}
                  />
                  <ReferenceLine
                    y={3}
                    stroke="#16a34a"
                    strokeDasharray="5 3"
                    strokeWidth={1.5}
                    opacity={0.5}
                    label={{ value: "Proficient", position: "insideTopRight", fontSize: 10, fill: "#16a34a", dy: -6 }}
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
              <div className="flex justify-center gap-4 mt-2">
                {([4, 3, 2, 1] as const).map((s) => (
                  <div key={s} className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: DOT_COLORS[s] }} />
                    <span className="text-xs text-slate-500">{s} · {SCORE_LABELS[s]}</span>
                  </div>
                ))}
              </div>
            </div>

          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      {/* Nested: full observation detail */}
      {detailObs && (
        <ObservationDetailModal
          teacher={teacher}
          observation={detailObs}
          open={detailObsId !== null}
          onOpenChange={(o) => { if (!o) setDetailObsId(null); }}
          onSave={handleSave}
        />
      )}
    </>
  );
}
