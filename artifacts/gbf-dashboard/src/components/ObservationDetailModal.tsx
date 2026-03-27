import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X, Pencil, Check, ChevronLeft } from "lucide-react";
import { CATEGORIES, ALL_DOMAINS, type Teacher, type Observation, type Score } from "@/data/dummy";
import { getScoreColorExact } from "@/components/ScoreCell";

const NAVY = "#1034B4";
const YELLOW = "#FFB500";

const SCORE_LABELS: Record<Score, string> = {
  1: "Needs Improvement",
  2: "Approaching",
  3: "Proficient",
  4: "Exemplary",
};

function scorePillClass(s: Score, selected: boolean): string {
  if (!selected) return "bg-slate-100 text-slate-400 hover:bg-slate-200 border border-transparent";
  switch (s) {
    case 4: return "bg-green-700 text-white border-2 border-green-600";
    case 3: return "bg-green-200 text-green-900 border-2 border-green-400";
    case 2: return "bg-yellow-100 text-yellow-900 border-2 border-yellow-300";
    case 1: return "bg-red-100 text-red-900 border-2 border-red-300";
  }
}

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

interface Props {
  teacher: Teacher;
  observation: Observation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (updated: Observation) => void;
}

export function ObservationDetailModal({ teacher, observation, open, onOpenChange, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [draftScores, setDraftScores] = useState<Record<string, Score>>(observation.scores);
  const [draftStrengths, setDraftStrengths] = useState(observation.strengths ?? "");
  const [draftGrowth, setDraftGrowth] = useState(observation.growthAreas ?? "");

  function startEdit() {
    setDraftScores(observation.scores);
    setDraftStrengths(observation.strengths ?? "");
    setDraftGrowth(observation.growthAreas ?? "");
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
  }

  function saveEdit() {
    onSave({
      ...observation,
      scores: draftScores,
      strengths: draftStrengths || undefined,
      growthAreas: draftGrowth || undefined,
    });
    setEditing(false);
  }

  const inputBase = "w-full px-3 py-2 rounded border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => { if (!o) { setEditing(false); } onOpenChange(o); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[60] w-full max-w-2xl max-h-[92vh] flex flex-col bg-white rounded-xl shadow-2xl overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">

          {/* ── Header ─────────────────────────────────── */}
          <div className="shrink-0 px-6 py-4" style={{ backgroundColor: NAVY }}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <DialogPrimitive.Title
                  className="text-white font-bold leading-tight"
                  style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 22, letterSpacing: "0.05em" }}
                >
                  {teacher.name}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-blue-200 text-sm mt-0.5">
                  Full Observation · {formatDate(observation.date)}
                </DialogPrimitive.Description>
                <p className="text-blue-300 text-xs mt-1">
                  Observed by <span className="text-blue-100 font-semibold">{observation.observer}</span>
                </p>
              </div>
              <DialogPrimitive.Close className="text-blue-300 hover:text-white transition-colors rounded p-1 mt-0.5 shrink-0">
                <X size={20} />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            </div>
          </div>

          {/* ── Mode bar ──────────────────────────────── */}
          {editing && (
            <div className="shrink-0 px-6 py-2.5 flex items-center gap-2 text-sm font-semibold" style={{ backgroundColor: "#fef3c7", borderBottom: "1px solid #fde68a" }}>
              <Pencil size={14} style={{ color: "#92400e" }} />
              <span style={{ color: "#92400e" }}>Editing observation — changes will update the dashboard.</span>
            </div>
          )}

          {/* ── Scrollable body ────────────────────────── */}
          <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5" style={{ fontFamily: "'Libre Franklin', sans-serif" }}>

            {/* Domain scores by category */}
            {CATEGORIES.map((cat) => (
              <div key={cat.id}>
                <div
                  className="px-3 py-1.5 rounded-t font-bold uppercase tracking-wider text-white"
                  style={{ backgroundColor: NAVY, fontFamily: "'Barlow Condensed', sans-serif", fontSize: 14, letterSpacing: "0.08em" }}
                >
                  {cat.label}
                </div>
                <div className="border border-t-0 border-slate-200 rounded-b divide-y divide-slate-100">
                  {cat.domains.map((domain) => {
                    const viewScore = observation.scores[domain.id] as Score;
                    const editScore = draftScores[domain.id] as Score;
                    return (
                      <div key={domain.id} className="flex items-center justify-between px-3 py-2.5 gap-4">
                        <span className="text-sm font-medium text-slate-700 flex-1">{domain.label}</span>
                        {editing ? (
                          <div className="flex gap-1.5 shrink-0">
                            {([1, 2, 3, 4] as Score[]).map((s) => (
                              <button
                                key={s}
                                type="button"
                                title={SCORE_LABELS[s]}
                                onClick={() => setDraftScores((prev) => ({ ...prev, [domain.id]: s }))}
                                className={`w-9 h-9 rounded font-bold text-sm transition-all ${scorePillClass(s, editScore === s)}`}
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <span className={`text-sm font-bold px-3 py-1 rounded min-w-[3rem] text-center ${getScoreColorExact(viewScore)}`}>
                            {viewScore} · {SCORE_LABELS[viewScore]}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Glows & Grows */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: "#16a34a" }}>
                  ✦ Glows (Strengths)
                </p>
                {editing ? (
                  <textarea
                    value={draftStrengths}
                    onChange={(e) => setDraftStrengths(e.target.value)}
                    placeholder="What is this teacher doing well?"
                    className={inputBase + " resize-none"}
                    rows={4}
                  />
                ) : (
                  <div className="rounded-lg border border-green-100 bg-green-50 px-3 py-2.5 min-h-[80px]">
                    <p className="text-sm text-slate-700 leading-relaxed">
                      {observation.strengths || <span className="text-slate-400 italic">No strengths recorded.</span>}
                    </p>
                  </div>
                )}
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: "#ea580c" }}>
                  ↑ Grows (Growth Areas)
                </p>
                {editing ? (
                  <textarea
                    value={draftGrowth}
                    onChange={(e) => setDraftGrowth(e.target.value)}
                    placeholder="Where should this teacher focus next?"
                    className={inputBase + " resize-none"}
                    rows={4}
                  />
                ) : (
                  <div className="rounded-lg border border-orange-100 bg-orange-50 px-3 py-2.5 min-h-[80px]">
                    <p className="text-sm text-slate-700 leading-relaxed">
                      {observation.growthAreas || <span className="text-slate-400 italic">No growth areas recorded.</span>}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Footer ─────────────────────────────────── */}
          <div className="shrink-0 px-6 py-4 border-t border-slate-200 flex justify-between items-center bg-slate-50">
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="flex items-center gap-1.5 px-4 py-2 rounded text-sm font-semibold text-slate-600 border border-slate-200 bg-white hover:bg-slate-100 transition-colors"
                >
                  <ChevronLeft size={14} /> Cancel
                </button>
                <button
                  type="button"
                  onClick={saveEdit}
                  className="flex items-center gap-1.5 px-6 py-2 rounded text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm"
                  style={{ backgroundColor: "#16a34a" }}
                >
                  <Check size={14} /> Save Changes
                </button>
              </>
            ) : (
              <>
                <p className="text-xs text-slate-400">
                  {teacher.department} · {teacher.gradeLevel} · {teacher.yearsExperience} yrs experience
                </p>
                <button
                  type="button"
                  onClick={startEdit}
                  className="flex items-center gap-1.5 px-5 py-2 rounded text-sm font-bold transition-opacity hover:opacity-90 shadow-sm"
                  style={{ backgroundColor: NAVY, color: "white" }}
                >
                  <Pencil size={13} /> Edit Observation
                </button>
              </>
            )}
          </div>

        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
