import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  fetchAdminSchools,
  createSchoolObservation,
  type CategoryEntry,
  type AdminSchool,
} from "@/lib/api";

const NAVY   = "#1034B4";
const YELLOW = "#FFB500";

const SCORE_OPTIONS = [
  { value: 0,   label: "0" },
  { value: 0.5, label: "0.5" },
  { value: 1,   label: "1" },
];

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
  const [strengths,   setStrengths]   = useState("");
  const [growthAreas, setGrowthAreas] = useState("");
  const [scores,      setScores]      = useState<Record<string, number>>({});
  const [error,       setError]       = useState("");

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
      const missingDomains = allDomains.filter((d) => scores[d.id] == null);
      if (missingDomains.length > 0) throw new Error("Please score all domains before saving");
      return createSchoolObservation({
        schoolId:    schoolId as number,
        rubricSetId,
        date,
        strengths:   strengths   || undefined,
        growthAreas: growthAreas || undefined,
        scores,
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
    setStrengths("");
    setGrowthAreas("");
    setScores({});
    setError("");
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        className="bg-white rounded-lg shadow-2xl w-full flex flex-col"
        style={{ maxWidth: 640, maxHeight: "90vh", fontFamily: "'Libre Franklin', sans-serif" }}
      >
        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between shrink-0 rounded-t-lg" style={{ backgroundColor: NAVY }}>
          <div>
            <h2 className="text-white font-bold uppercase tracking-wide" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: "0.04em" }}>
              Add School Observation
            </h2>
            <p className="text-white/70 text-xs mt-0.5">{rubricSetName}</p>
          </div>
          <button
            onClick={handleClose}
            className="text-white/70 hover:text-white transition-colors text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 flex flex-col gap-5">

          {/* School + Date row */}
          <div className="flex gap-4">
            <div className="flex-1 flex flex-col gap-1">
              <label className="text-xs font-bold uppercase tracking-wider" style={{ color: NAVY }}>School</label>
              <select
                value={schoolId}
                onChange={(e) => setSchoolId(e.target.value === "" ? "" : Number(e.target.value))}
                className="rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2"
                style={{ borderColor: "#dde3f0", focusRingColor: NAVY } as React.CSSProperties}
              >
                <option value="">Select school…</option>
                {schools.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1" style={{ width: 150 }}>
              <label className="text-xs font-bold uppercase tracking-wider" style={{ color: NAVY }}>Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2"
                style={{ borderColor: "#dde3f0" }}
              />
            </div>
          </div>

          {/* Domain Scores */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: NAVY }}>
              Domain Scores
            </h3>
            <div className="flex flex-col gap-3">
              {categories.map((cat) => (
                <div key={cat.id}>
                  <div
                    className="text-xs font-bold uppercase tracking-wider mb-2 pb-1"
                    style={{ color: NAVY, borderBottom: `2px solid ${YELLOW}` }}
                  >
                    {cat.label}
                  </div>
                  <div className="flex flex-col gap-2">
                    {cat.domains.map((domain) => (
                      <div key={domain.id} className="flex items-center gap-3">
                        <span className="text-sm flex-1" style={{ color: "#333" }}>{domain.label}</span>
                        <div className="flex rounded overflow-hidden shrink-0" style={{ border: `1.5px solid ${NAVY}` }}>
                          {SCORE_OPTIONS.map((opt, i, arr) => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => setScores((prev) => ({ ...prev, [domain.id]: opt.value }))}
                              className="px-3 py-1 text-xs font-bold transition-colors"
                              style={{
                                backgroundColor: scores[domain.id] === opt.value ? NAVY : "transparent",
                                color: scores[domain.id] === opt.value ? "white" : NAVY,
                                borderRight: i < arr.length - 1 ? `1px solid ${NAVY}` : undefined,
                                fontFamily: "'Bebas Neue', sans-serif",
                                fontSize: 14,
                                minWidth: 36,
                              }}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Strengths */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold uppercase tracking-wider" style={{ color: NAVY }}>Strengths <span className="font-normal normal-case text-gray-400">(optional)</span></label>
            <textarea
              value={strengths}
              onChange={(e) => setStrengths(e.target.value)}
              rows={3}
              placeholder="What went well school-wide…"
              className="rounded border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2"
              style={{ borderColor: "#dde3f0" }}
            />
          </div>

          {/* Growth Areas */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold uppercase tracking-wider" style={{ color: NAVY }}>Growth Areas <span className="font-normal normal-case text-gray-400">(optional)</span></label>
            <textarea
              value={growthAreas}
              onChange={(e) => setGrowthAreas(e.target.value)}
              rows={3}
              placeholder="Areas for school-wide growth…"
              className="rounded border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2"
              style={{ borderColor: "#dde3f0" }}
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 font-medium">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 shrink-0 flex justify-end gap-3" style={{ borderTop: "1px solid #dde3f0" }}>
          <button
            onClick={handleClose}
            disabled={mutation.isPending}
            className="px-5 py-2 rounded font-semibold text-sm transition-colors"
            style={{ border: `1.5px solid ${NAVY}`, color: NAVY, backgroundColor: "transparent" }}
          >
            Cancel
          </button>
          <button
            onClick={() => { setError(""); mutation.mutate(); }}
            disabled={mutation.isPending}
            className="px-6 py-2 rounded font-bold text-sm text-white uppercase tracking-wide transition-opacity"
            style={{
              backgroundColor: NAVY,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 16,
              letterSpacing: "0.04em",
              opacity: mutation.isPending ? 0.6 : 1,
            }}
          >
            {mutation.isPending ? "Saving…" : "Save Observation"}
          </button>
        </div>
      </div>
    </div>
  );
}
