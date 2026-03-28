import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X, Plus } from "lucide-react";
import { type Score, type Teacher } from "@/data/dummy";
import type { CategoryEntry, DomainEntry } from "@/lib/api";

const NAVY = "#1034B4";
const YELLOW = "#FFB500";

interface Props {
  teachers: Teacher[];
  categories: CategoryEntry[];
  allDomains: DomainEntry[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isDistrictAdmin?: boolean;
  onSubmit: (
    teacherId: string,
    date: string,
    scores: Record<string, Score>,
    strengths: string,
    growthAreas: string,
    isWalkthrough: boolean,
  ) => void;
  saving?: boolean;
}

const SCORE_LABELS: Record<Score, string> = {
  1: "Needs Improvement",
  2: "Approaching",
  3: "Proficient",
  4: "Exemplary",
};

function scorePillClass(s: Score, selected: boolean): string {
  if (!selected) return "bg-slate-100 text-slate-400 hover:bg-slate-200 border border-slate-200";
  switch (s) {
    case 4: return "bg-green-700 text-white border-2 border-green-600 shadow-sm";
    case 3: return "bg-green-200 text-green-900 border-2 border-green-400 shadow-sm";
    case 2: return "bg-yellow-100 text-yellow-900 border-2 border-yellow-300 shadow-sm";
    case 1: return "bg-red-100 text-red-900 border-2 border-red-300 shadow-sm";
  }
}

export function NewObservationModal({ teachers, categories, allDomains, open, onOpenChange, isDistrictAdmin, onSubmit, saving }: Props) {
  const todayIso = new Date().toISOString().split("T")[0];

  const [teacherId, setTeacherId] = useState(teachers[0]?.id ?? "");
  const [date, setDate] = useState(todayIso);
  const [scores, setScores] = useState<Partial<Record<string, Score>>>({});
  const [strengths, setStrengths] = useState("");
  const [growthAreas, setGrowthAreas] = useState("");
  const [isWalkthrough, setIsWalkthrough] = useState(false);

  const scoredCount = allDomains.filter((d) => scores[d.id] !== undefined).length;

  function reset() {
    setTeacherId(teachers[0]?.id ?? "");
    setDate(todayIso);
    setScores({});
    setStrengths("");
    setGrowthAreas("");
    setIsWalkthrough(false);
  }

  function handleSubmit() {
    if (!teacherId) return;
    onSubmit(teacherId, date, scores as Record<string, Score>, strengths, growthAreas, isWalkthrough);
    reset();
    onOpenChange(false);
  }

  const inputBase =
    "w-full px-3 py-2 rounded border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed z-50 flex flex-col bg-white shadow-2xl overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 inset-x-2 inset-y-3 rounded-xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-full sm:max-w-2xl sm:max-h-[92vh]">

          {/* ── Modal Header ─────────────────────────────── */}
          <div className="shrink-0 px-6 py-4" style={{ backgroundColor: NAVY }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: YELLOW }}
                >
                  <Plus size={16} color={NAVY} strokeWidth={3} />
                </div>
                <DialogPrimitive.Title
                  className="text-white font-bold uppercase tracking-wider"
                  style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: "0.03em" }}
                >
                  New Observation
                </DialogPrimitive.Title>
              </div>
              <DialogPrimitive.Close className="text-blue-300 hover:text-white transition-colors rounded p-1">
                <X size={20} />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            </div>
          </div>

          {/* ── Scrollable Body ───────────────────────────── */}
          <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5" style={{ fontFamily: "'Libre Franklin', sans-serif" }}>

            {/* Teacher + Date */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Teacher
                </label>
                <select
                  value={teacherId}
                  onChange={(e) => setTeacherId(e.target.value)}
                  className={inputBase}
                >
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.subject}, Grade{t.gradeLevel.length !== 1 ? "s" : ""} {t.gradeLevel.join(", ")})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Observation Date
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={inputBase}
                />
              </div>
            </div>

            {/* District Walkthrough toggle (only for DISTRICT_ADMIN) */}
            {isDistrictAdmin && (
              <div
                className="flex items-center justify-between px-4 py-3 rounded-lg"
                style={{ backgroundColor: isWalkthrough ? "#EEF1FB" : "#f8fafc", border: `1.5px solid ${isWalkthrough ? NAVY : "#dde3f0"}` }}
              >
                <div>
                  <p className="font-bold text-sm" style={{ color: NAVY }}>District Walkthrough</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Mark this as an official district walkthrough. Teachers scoring below 3.0 will be added to the rescore queue.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isWalkthrough}
                  onClick={() => setIsWalkthrough((v) => !v)}
                  className="relative shrink-0 ml-4 w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300"
                  style={{ backgroundColor: isWalkthrough ? NAVY : "#cbd5e1" }}
                >
                  <span
                    className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200"
                    style={{ transform: isWalkthrough ? "translateX(20px)" : "translateX(0)" }}
                  />
                </button>
              </div>
            )}

            {/* Progress indicator */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: allDomains.length ? `${(scoredCount / allDomains.length) * 100}%` : "0%",
                    backgroundColor: scoredCount === allDomains.length ? "#16a34a" : NAVY,
                  }}
                />
              </div>
              <span className="text-xs font-semibold shrink-0" style={{ color: scoredCount === allDomains.length ? "#16a34a" : "#64748b" }}>
                {scoredCount} / {allDomains.length} scored
              </span>
            </div>

            {/* Score legend */}
            <div className="flex items-center gap-3 flex-wrap text-xs font-semibold">
              <span className="text-slate-400 uppercase tracking-wide mr-1">Scale:</span>
              {([1, 2, 3, 4] as Score[]).map((s) => (
                <span key={s} className={`px-2.5 py-0.5 rounded ${scorePillClass(s, true)}`}>
                  {s} · {SCORE_LABELS[s]}
                </span>
              ))}
            </div>

            {/* Domain scores per category */}
            {categories.map((cat) => (
              <div key={cat.id}>
                <div
                  className="px-3 py-1.5 rounded-t font-bold uppercase tracking-wider text-white text-xs"
                  style={{ backgroundColor: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 14, letterSpacing: "0.02em" }}
                >
                  {cat.label}
                </div>
                <div className="border border-t-0 border-slate-200 rounded-b divide-y divide-slate-100">
                  {cat.domains.map((domain) => {
                    const isUnscored = scores[domain.id] === undefined;
                    return (
                      <div
                        key={domain.id}
                        className="flex items-center justify-between px-3 py-2.5 transition-colors"
                      >
                        <span className="text-sm font-medium flex-1 pr-4 text-slate-700">
                          {domain.label}
                          {isUnscored && (
                            <span className="ml-2 text-xs font-normal text-slate-400 italic">— not scored</span>
                          )}
                        </span>
                        <div className="flex gap-1.5 shrink-0">
                          {([1, 2, 3, 4] as Score[]).map((s) => (
                            <button
                              key={s}
                              type="button"
                              title={SCORE_LABELS[s]}
                              onClick={() => setScores((prev) => ({ ...prev, [domain.id]: s }))}
                              className={`w-9 h-9 rounded font-bold text-sm transition-all ${scorePillClass(s, scores[domain.id] === s)}`}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Notes */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: "#16a34a" }}>
                  ✦ Teacher Strengths (Glows)
                </label>
                <textarea
                  value={strengths}
                  onChange={(e) => setStrengths(e.target.value)}
                  placeholder="What is this teacher doing well?"
                  className="w-full px-3 py-2 rounded border border-slate-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-300 bg-white"
                  rows={4}
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: "#ea580c" }}>
                  ↑ Growth Areas (Grows)
                </label>
                <textarea
                  value={growthAreas}
                  onChange={(e) => setGrowthAreas(e.target.value)}
                  placeholder="Where should this teacher focus next?"
                  className="w-full px-3 py-2 rounded border border-slate-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-200 bg-white"
                  rows={4}
                />
              </div>
            </div>
          </div>

          {/* ── Footer ───────────────────────────────────── */}
          <div className="shrink-0 px-4 sm:px-6 py-3 sm:py-4 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 bg-slate-50">
            <p className="text-xs text-slate-400 order-2 sm:order-1">
              {scoredCount === allDomains.length
                ? "✓ All domains scored."
                : `${scoredCount} of ${allDomains.length} domains scored — unscored domains will be left blank.`}
            </p>
            <div className="flex gap-2 sm:gap-3 order-1 sm:order-2">
              <DialogPrimitive.Close
                className="flex-1 sm:flex-none px-4 sm:px-5 py-2 rounded text-sm font-semibold text-slate-600 border border-slate-200 bg-white hover:bg-slate-100 transition-colors text-center"
              >
                Cancel
              </DialogPrimitive.Close>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={saving}
                className="flex-1 sm:flex-none px-4 sm:px-6 py-2 rounded text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm disabled:opacity-60"
                style={{ backgroundColor: NAVY }}
              >
                {saving ? "Saving…" : isWalkthrough ? "Submit Walkthrough" : "Submit Observation"}
              </button>
            </div>
          </div>

        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
