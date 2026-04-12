import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X, Pencil, Check, ChevronLeft } from "lucide-react";
import { type Observation, type Score } from "@/data/dummy";
import { type CategoryEntry } from "@/lib/api";
import { getScoreColorExact } from "@/components/ScoreCell";

const NAVY = "#1034B4";
const YELLOW = "#FFB500";

const SCORE_OPTIONS: { value: Score; label: string }[] = [
  { value: 0,   label: "Not Yet" },
  { value: 0.5, label: "Developing" },
  { value: 1,   label: "Proficient" },
];

const SCORE_LABEL_MAP: Record<number, string> = {
  0:   "Not Yet",
  0.5: "Developing",
  1:   "Proficient",
};

function scorePillClass(s: Score, selected: boolean): string {
  if (!selected) return "bg-slate-100 text-slate-400 hover:bg-slate-200 border border-transparent";
  if (s >= 1)   return "bg-green-600 text-white border-2 border-green-500";
  if (s >= 0.5) return "bg-yellow-300 text-yellow-900 border-2 border-yellow-400";
  return "bg-red-300 text-red-900 border-2 border-red-400";
}

function scoreDisplay(s: Score): string {
  if (s === 0) return "0";
  if (s === 1) return "1";
  return "0.5";
}

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface TeacherMeta {
  name: string;
  subject: string;
  gradeLevel: string[];
}

interface Props {
  teacher: TeacherMeta;
  observation: Observation;
  categories: CategoryEntry[];
  canEdit: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (updated: Observation) => Promise<void>;
}

export function ObservationDetailModal({
  teacher, observation, categories, canEdit, open, onOpenChange, onSave,
}: Props) {
  const [editing, setEditing]           = useState(false);
  const [saving, setSaving]             = useState(false);
  const [saveError, setSaveError]       = useState<string | null>(null);
  const [draftScores, setDraftScores]   = useState<Record<string, Score>>(observation.scores);
  const [draftStrengths, setDraftStrengths] = useState(observation.strengths ?? "");
  const [draftGrowth, setDraftGrowth]   = useState(observation.growthAreas ?? "");

  function startEdit() {
    setDraftScores(observation.scores);
    setDraftStrengths(observation.strengths ?? "");
    setDraftGrowth(observation.growthAreas ?? "");
    setSaveError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setSaveError(null);
    setEditing(false);
  }

  async function saveEdit() {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({
        ...observation,
        scores: draftScores,
        strengths: draftStrengths || undefined,
        growthAreas: draftGrowth || undefined,
      });
      setEditing(false);
    } catch {
      setSaveError("Failed to save — please try again.");
    } finally {
      setSaving(false);
    }
  }

  const inputBase =
    "w-full px-3 py-2 rounded border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white";

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) { setEditing(false); setSaveError(null); }
        onOpenChange(o);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed z-[60] flex flex-col bg-white rounded-xl shadow-2xl overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 inset-x-2 inset-y-3 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-full sm:max-w-2xl sm:max-h-[92vh]">

          {/* ── Header ─────────────────────────────────── */}
          <div className="shrink-0 px-6 py-4" style={{ backgroundColor: NAVY }}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <DialogPrimitive.Title
                  className="text-white font-bold leading-tight"
                  style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: "0.02em" }}
                >
                  {teacher.name}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-blue-200 text-sm mt-0.5">
                  {observation.isWalkthrough ? "Walkthrough" : "Full Observation"} · {formatDate(observation.date)}
                </DialogPrimitive.Description>
                <p className="text-blue-300 text-xs mt-1">
                  Observed by{" "}
                  <span className="text-blue-100 font-semibold">{observation.observer}</span>
                </p>
              </div>
              <DialogPrimitive.Close className="text-blue-300 hover:text-white transition-colors rounded p-1 mt-0.5 shrink-0">
                <X size={20} />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            </div>
          </div>

          {/* ── Edit mode bar ─────────────────────────── */}
          {editing && (
            <div
              className="shrink-0 px-6 py-2.5 flex items-center gap-2 text-sm font-semibold"
              style={{ backgroundColor: "#fef3c7", borderBottom: "1px solid #fde68a" }}
            >
              <Pencil size={14} style={{ color: "#92400e" }} />
              <span style={{ color: "#92400e" }}>
                Editing observation — the original date will not change.
              </span>
            </div>
          )}

          {/* ── Audit trail banner ────────────────────── */}
          {!editing && observation.editedBy && (
            <div
              className="shrink-0 px-6 py-2 flex items-center gap-2 text-xs"
              style={{ backgroundColor: "#f0f9ff", borderBottom: "1px solid #bae6fd" }}
            >
              <Pencil size={12} style={{ color: "#0369a1" }} />
              <span style={{ color: "#0369a1" }}>
                Edited by{" "}
                <span className="font-semibold">{observation.editedBy}</span>
                {observation.editedAt && (
                  <> on {formatDateTime(observation.editedAt)}</>
                )}
              </span>
            </div>
          )}

          {/* ── Save error ────────────────────────────── */}
          {saveError && (
            <div className="shrink-0 px-6 py-2 text-sm text-red-700 bg-red-50 border-b border-red-200">
              {saveError}
            </div>
          )}

          {/* ── Scrollable body ───────────────────────── */}
          <div
            className="overflow-y-auto flex-1 px-6 py-5 space-y-5"
            style={{ fontFamily: "'Libre Franklin', sans-serif" }}
          >
            {/* Domain scores by category */}
            {categories.map((cat) => (
              <div key={cat.id}>
                <div
                  className="px-3 py-1.5 rounded-t font-bold uppercase tracking-wider text-white"
                  style={{
                    backgroundColor: NAVY,
                    fontFamily: "'Bebas Neue', sans-serif",
                    fontSize: 14,
                    letterSpacing: "0.02em",
                  }}
                >
                  {cat.label}
                </div>
                <div className="border border-t-0 border-slate-200 rounded-b divide-y divide-slate-100">
                  {cat.domains.map((domain) => {
                    const viewScore = observation.scores[domain.id] as Score | undefined;
                    const editScore = draftScores[domain.id] as Score | undefined;
                    return (
                      <div key={domain.id} className="flex items-center justify-between px-3 py-2.5 gap-4">
                        <span className="text-sm font-medium text-slate-700 flex-1">{domain.label}</span>
                        {editing ? (
                          <div className="flex gap-2 shrink-0">
                            {SCORE_OPTIONS.map(({ value, label }) => (
                              <button
                                key={value}
                                type="button"
                                title={label}
                                onClick={() =>
                                  setDraftScores((prev) => ({ ...prev, [domain.id]: value }))
                                }
                                className={`px-3 h-9 rounded font-bold text-sm transition-all whitespace-nowrap ${scorePillClass(value, editScore === value)}`}
                              >
                                {scoreDisplay(value)}
                              </button>
                            ))}
                          </div>
                        ) : viewScore !== undefined ? (
                          <span
                            className={`text-sm font-bold px-3 py-1 rounded min-w-[5rem] text-center ${getScoreColorExact(viewScore)}`}
                          >
                            {scoreDisplay(viewScore)} · {SCORE_LABEL_MAP[viewScore] ?? "—"}
                          </span>
                        ) : (
                          <span className="text-sm text-slate-400 italic px-3 py-1">not scored</span>
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
                <p
                  className="text-xs font-bold uppercase tracking-wider mb-1.5"
                  style={{ color: "#16a34a" }}
                >
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
                      {observation.strengths || (
                        <span className="text-slate-400 italic">No strengths recorded.</span>
                      )}
                    </p>
                  </div>
                )}
              </div>
              <div>
                <p
                  className="text-xs font-bold uppercase tracking-wider mb-1.5"
                  style={{ color: "#ea580c" }}
                >
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
                      {observation.growthAreas || (
                        <span className="text-slate-400 italic">No growth areas recorded.</span>
                      )}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Footer ──────────────────────────────────── */}
          <div className="shrink-0 px-6 py-4 border-t border-slate-200 flex justify-between items-center bg-slate-50">
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-2 rounded text-sm font-semibold text-slate-600 border border-slate-200 bg-white hover:bg-slate-100 transition-colors disabled:opacity-50"
                >
                  <ChevronLeft size={14} /> Cancel
                </button>
                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-6 py-2 rounded text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm disabled:opacity-60"
                  style={{ backgroundColor: "#16a34a" }}
                >
                  {saving ? (
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Check size={14} />
                  )}
                  {saving ? "Saving…" : "Save Changes"}
                </button>
              </>
            ) : (
              <>
                <p className="text-xs text-slate-400">
                  {teacher.subject} · Grade{teacher.gradeLevel.length !== 1 ? "s" : ""}{" "}
                  {teacher.gradeLevel.join(", ")}
                </p>
                {canEdit && (
                  <button
                    type="button"
                    onClick={startEdit}
                    className="flex items-center gap-1.5 px-5 py-2 rounded text-sm font-bold transition-opacity hover:opacity-90 shadow-sm"
                    style={{ backgroundColor: NAVY, color: "white" }}
                  >
                    <Pencil size={13} /> Edit Observation
                  </button>
                )}
              </>
            )}
          </div>

        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
