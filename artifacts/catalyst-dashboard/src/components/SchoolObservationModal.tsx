import { useState, useMemo } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X, Plus } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  fetchAdminSchools,
  createSchoolObservation,
  type CategoryEntry,
  type AdminSchool,
} from "@/lib/api";

const NAVY   = "#1034B4";
const YELLOW = "#FFB500";

const SCORE_OPTIONS: { value: number; label: string }[] = [
  { value: 0,   label: "Not Yet" },
  { value: 0.5, label: "Developing" },
  { value: 1,   label: "Proficient" },
];

function scorePillClass(s: number, selected: boolean): string {
  if (!selected) return "bg-slate-100 text-slate-400 hover:bg-slate-200 border border-slate-200";
  if (s >= 1)   return "bg-green-600 text-white border-2 border-green-500 shadow-sm";
  if (s >= 0.5) return "bg-yellow-300 text-yellow-900 border-2 border-yellow-400 shadow-sm";
  return "bg-red-300 text-red-900 border-2 border-red-400 shadow-sm";
}

interface Props {
  open:          boolean;
  onOpenChange:  (open: boolean) => void;
  rubricSetId:   number;
  rubricSetName: string;
  categories:    CategoryEntry[];
  onSaved:       () => void;
}

export default function SchoolObservationModal({
  open,
  onOpenChange,
  rubricSetId,
  rubricSetName,
  categories,
  onSaved,
}: Props) {
  const allDomains = categories.flatMap((c) => c.domains);

  const [schoolId,    setSchoolId]    = useState<number | "">("");
  const [date,        setDate]        = useState(() => new Date().toISOString().split("T")[0]);
  const [scores,      setScores]      = useState<Record<string, number | undefined>>({});
  const [error,       setError]       = useState("");

  const scoredCount = useMemo(
    () => allDomains.filter((d) => scores[d.id] != null).length,
    [allDomains, scores],
  );

  const inputBase =
    "w-full px-3 py-2 rounded border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white";

  const { data: schools = [] } = useQuery<AdminSchool[]>({
    queryKey: ["adminSchools"],
    queryFn:  fetchAdminSchools,
    staleTime: 60_000,
    enabled:   open,
  });

  const mutation = useMutation({
    mutationFn: () => {
      if (!schoolId) throw new Error("Please select a school");
      if (!date)     throw new Error("Please enter a date");
      return createSchoolObservation({
        schoolId:    schoolId as number,
        rubricSetId,
        date,
        scores:      scores as Record<string, number>,
        target:      "SCHOOL",
      });
    },
    onSuccess: () => {
      onSaved();
      handleClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  function handleClose() {
    onOpenChange(false);
    setSchoolId("");
    setDate(new Date().toISOString().split("T")[0]);
    setScores({});
    setError("");
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => { if (!o) handleClose(); onOpenChange(o); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed z-50 flex flex-col bg-white shadow-2xl overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 inset-x-2 inset-y-3 rounded-xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-full sm:max-w-2xl sm:max-h-[74vh]">

          {/* ── Header ───────────────────────────────────── */}
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
                  Add School Observation
                </DialogPrimitive.Title>
              </div>
              <DialogPrimitive.Close className="text-blue-300 hover:text-white transition-colors rounded p-1">
                <X size={20} />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            </div>
            <p className="text-white/60 text-xs mt-1 ml-11">{rubricSetName}</p>
          </div>

          {/* ── Body ─────────────────────────────────────── */}
          <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5" style={{ fontFamily: "'Libre Franklin', sans-serif" }}>

            {/* School + Date row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  School
                </label>
                <select
                  value={schoolId}
                  onChange={(e) => setSchoolId(e.target.value === "" ? "" : Number(e.target.value))}
                  className={inputBase}
                >
                  <option value="">Select school…</option>
                  {schools.map((s) => (
                    <option key={s.id} value={s.id}>{s.displayName}</option>
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

            {/* Progress bar */}
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
              {SCORE_OPTIONS.map(({ value, label }) => (
                <span key={value} className={`px-2.5 py-0.5 rounded ${scorePillClass(value, true)}`}>
                  {value === 0 ? "0" : value === 1 ? "1" : "0.5"} · {label}
                </span>
              ))}
            </div>

            {/* Domain scores per category */}
            {categories.map((cat) => (
              <div key={cat.id}>
                <div
                  className="px-3 py-2 rounded-t font-bold uppercase tracking-wider text-white"
                  style={{ backgroundColor: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: "0.04em" }}
                >
                  {cat.label}
                </div>
                <div className="border border-t-0 border-slate-200 rounded-b divide-y divide-slate-100">
                  {cat.domains.map((domain) => (
                    <div
                      key={domain.id}
                      className="flex items-start justify-between px-3 py-2.5 transition-colors gap-4"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-700">{domain.label}</p>
                        {domain.description && (
                          <p className="text-xs text-slate-400 mt-0.5 leading-snug">{domain.description}</p>
                        )}
                      </div>
                      <div className="flex gap-2 shrink-0">
                        {SCORE_OPTIONS.map(({ value, label }) => (
                          <button
                            key={value}
                            type="button"
                            title={label}
                            onClick={() => setScores((prev) => ({ ...prev, [domain.id]: prev[domain.id] === value ? undefined : value }))}
                            className={`px-3 h-9 rounded font-bold text-sm transition-all whitespace-nowrap ${scorePillClass(value, scores[domain.id] === value)}`}
                          >
                            {value === 0 ? "0" : value === 1 ? "1" : "0.5"}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

          </div>

          {/* ── Footer ───────────────────────────────────── */}
          <div className="shrink-0 px-4 sm:px-6 py-3 sm:py-4 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 bg-slate-50">
            <div className="flex items-center gap-3 order-2 sm:order-1 min-w-0">
              {error
                ? <p className="text-xs text-red-600 font-semibold truncate">{error}</p>
                : <p className="text-xs text-slate-400 truncate">
                    {scoredCount === allDomains.length
                      ? "✓ All domains scored."
                      : `${scoredCount} of ${allDomains.length} domains scored`}
                  </p>
              }
            </div>
            <div className="flex gap-2 sm:gap-3 order-1 sm:order-2 shrink-0">
              <DialogPrimitive.Close
                className="px-4 sm:px-5 py-2 rounded text-sm font-semibold text-slate-600 border border-slate-200 bg-white hover:bg-slate-100 transition-colors text-center"
              >
                Close
              </DialogPrimitive.Close>
              <button
                type="button"
                onClick={() => { setError(""); mutation.mutate(); }}
                disabled={mutation.isPending}
                className="px-5 sm:px-7 py-2 rounded text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm disabled:opacity-60"
                style={{ backgroundColor: NAVY }}
              >
                {mutation.isPending ? "Saving…" : "Submit"}
              </button>
            </div>
          </div>

        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
