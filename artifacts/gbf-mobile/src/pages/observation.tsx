import React, { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useApp } from "@/context/AppContext";
import { AppHeader } from "@/components/AppHeader";
import { apiFetch, Teacher, RubricCategory, Score } from "@/lib/api";
import { CheckCircle, Loader2, AlertCircle, ChevronDown } from "lucide-react";

const NAVY = "#1034B4";
const YELLOW = "#FFB500";

const SCORE_OPTIONS: { value: Score; label: string }[] = [
  { value: 0, label: "Not Yet" },
  { value: 0.5, label: "Developing" },
  { value: 1, label: "Proficient" },
];

function scorePillStyle(value: Score, selected: boolean): React.CSSProperties {
  if (!selected) return { backgroundColor: "#f1f5f9", color: "#94a3b8", border: "1px solid #e2e8f0" };
  if (value >= 1) return { backgroundColor: "#16a34a", color: "#ffffff", border: "2px solid #15803d" };
  if (value >= 0.5) return { backgroundColor: "#fde68a", color: "#92400e", border: "2px solid #fbbf24" };
  return { backgroundColor: "#fca5a5", color: "#991b1b", border: "2px solid #f87171" };
}

interface RubricData {
  rubricSet: { id: number; slug: string; name: string };
  categories: RubricCategory[];
}

export default function ObservationPage() {
  const { user } = useAuth();
  const { selectedSchool, selectedRubric, setSelectedSchool } = useApp();
  const [, navigate] = useLocation();

  const isNetworkAdmin = user?.role === "NETWORK_ADMIN";
  const canMarkWalkthrough =
    user?.role === "NETWORK_ADMIN" ||
    user?.role === "NETWORK_LEADER" ||
    user?.role === "SCHOOL_LEADER";

  const effectiveSchoolId = selectedSchool?.id ?? user?.schoolId ?? null;

  const isNetworkScope = user?.role === "NETWORK_ADMIN" || user?.role === "NETWORK_LEADER";

  useEffect(() => {
    if (!user) { navigate("/"); return; }
    if (isNetworkScope && !selectedSchool) { navigate("/school-picker"); return; }
    if (!selectedRubric) { navigate("/rubric-picker"); return; }
  }, [user, selectedSchool, selectedRubric, isNetworkScope]);

  const { data: teachers, isLoading: loadingTeachers, isError: errorTeachers } = useQuery<Teacher[]>({
    queryKey: ["teachers", effectiveSchoolId],
    queryFn: async () => {
      const all = await apiFetch<Teacher[]>("/api/admin/teachers");
      return all.filter((t) => t.isActive && (effectiveSchoolId == null || t.schoolId === effectiveSchoolId));
    },
    enabled: !!user,
  });

  const { data: rubricData, isLoading: loadingRubric, isError: errorRubric } = useQuery<RubricData>({
    queryKey: ["rubric", selectedRubric?.slug],
    queryFn: () => apiFetch<RubricData>(`/api/rubric/${selectedRubric!.slug}`),
    enabled: !!selectedRubric,
  });

  const todayIso = new Date().toISOString().split("T")[0];
  const [teacherId, setTeacherId] = useState<string>("");
  const [date, setDate] = useState(todayIso);
  const [course, setCourse] = useState("");
  const [scores, setScores] = useState<Partial<Record<string, Score>>>({});
  const [strengths, setStrengths] = useState("");
  const [growthAreas, setGrowthAreas] = useState("");
  const [isWalkthrough, setIsWalkthrough] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (teachers && teachers.length > 0 && !teacherId) {
      setTeacherId(String(teachers[0].id));
    }
  }, [teachers]);

  const allDomains = rubricData?.categories.flatMap((c) => c.domains) ?? [];
  const scoredCount = allDomains.filter((d) => scores[d.slug] !== undefined).length;

  function resetForm() {
    setTeacherId(teachers?.[0] ? String(teachers[0].id) : "");
    setDate(new Date().toISOString().split("T")[0]);
    setCourse("");
    setScores({});
    setStrengths("");
    setGrowthAreas("");
    setIsWalkthrough(false);
    setSubmitError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!teacherId || !selectedRubric) return;
    setSaving(true);
    setSubmitError(null);
    try {
      await apiFetch("/api/observations", {
        method: "POST",
        body: JSON.stringify({
          teacherId: Number(teacherId),
          rubricSetId: selectedRubric.id,
          date,
          course: course || null,
          strengths: strengths || null,
          growthAreas: growthAreas || null,
          scores: Object.fromEntries(Object.entries(scores).filter(([, v]) => v !== undefined)),
          isWalkthrough,
        }),
      });
      setConfirmed(true);
      setTimeout(() => {
        setConfirmed(false);
        resetForm();
      }, 2500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save observation";
      setSubmitError(msg);
    } finally {
      setSaving(false);
    }
  }

  function handleSwitchSchool() {
    setSelectedSchool(null);
    navigate("/school-picker");
  }

  const schoolName = selectedSchool?.name ?? user?.schoolName ?? undefined;
  const subtitle = [schoolName, selectedRubric?.name].filter(Boolean).join(" · ");

  const isLoading = loadingTeachers || loadingRubric;
  const isError = errorTeachers || errorRubric;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <AppHeader
        subtitle={subtitle}
        onSwitchSchool={isNetworkAdmin ? handleSwitchSchool : undefined}
      />

      {/* Confirmation overlay */}
      {confirmed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6">
          <div className="bg-white rounded-2xl p-6 shadow-2xl flex flex-col items-center gap-3 w-full max-w-xs">
            <CheckCircle size={40} style={{ color: "#16a34a" }} />
            <p className="font-bold text-slate-800 text-base" style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, color: NAVY, letterSpacing: 1 }}>
              Observation Saved!
            </p>
            <p className="text-sm text-slate-500 text-center">The form will reset for your next observation.</p>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto pb-32">
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 size={28} className="animate-spin" style={{ color: NAVY }} />
            <p className="text-sm text-slate-500">Loading form…</p>
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 px-6 text-center">
            <AlertCircle size={32} className="text-red-400" />
            <p className="text-sm font-semibold text-red-500">Failed to load observation form</p>
          </div>
        )}

        {!isLoading && !isError && teachers && rubricData && (
          <form id="obs-form" onSubmit={handleSubmit} className="px-4 pt-4 flex flex-col gap-4">

            {/* Teacher + Date */}
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex flex-col gap-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">Teacher</label>
                <div className="relative">
                  <select
                    value={teacherId}
                    onChange={(e) => setTeacherId(e.target.value)}
                    required
                    className="w-full appearance-none px-3 py-2.5 pr-9 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 bg-white text-slate-800"
                    style={{ fontFamily: "'Libre Franklin', sans-serif" }}
                  >
                    <option value="" disabled>Select a teacher…</option>
                    {teachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.subject}{t.gradeLevel?.length ? `, Gr. ${t.gradeLevel.join("/")}` : ""})
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Observation Date
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 bg-white text-slate-800"
                />
              </div>
            </div>

            {/* Subject / Course */}
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Subject / Course Being Observed
              </label>
              <input
                type="text"
                value={course}
                onChange={(e) => setCourse(e.target.value)}
                placeholder="e.g. AP Biology, 8th Grade Math, ELA Block 2…"
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 bg-white text-slate-800"
                style={{ fontFamily: "'Libre Franklin', sans-serif" }}
              />
            </div>

            {/* Walkthrough toggle */}
            {canMarkWalkthrough && (
              <div
                className="flex items-center justify-between px-4 py-3 rounded-xl"
                style={{ backgroundColor: isWalkthrough ? "#EEF1FB" : "#f8fafc", border: `1.5px solid ${isWalkthrough ? NAVY : "#dde3f0"}` }}
              >
                <div className="flex-1 min-w-0 pr-3">
                  <p className="font-bold text-sm" style={{ color: NAVY }}>Walkthrough / Rescore</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-snug">
                    Count as an official walkthrough. Teachers below 0.7 go to rescore queue.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isWalkthrough}
                  onClick={() => setIsWalkthrough((v) => !v)}
                  className="relative shrink-0 w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300"
                  style={{ backgroundColor: isWalkthrough ? NAVY : "#cbd5e1" }}
                >
                  <span
                    className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200"
                    style={{ transform: isWalkthrough ? "translateX(20px)" : "translateX(0)" }}
                  />
                </button>
              </div>
            )}

            {/* Progress bar */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: allDomains.length ? `${(scoredCount / allDomains.length) * 100}%` : "0%",
                    backgroundColor: scoredCount === allDomains.length && allDomains.length > 0 ? "#16a34a" : NAVY,
                  }}
                />
              </div>
              <span
                className="text-xs font-semibold shrink-0"
                style={{ color: scoredCount === allDomains.length && allDomains.length > 0 ? "#16a34a" : "#64748b" }}
              >
                {scoredCount} / {allDomains.length} scored
              </span>
            </div>

            {/* Score legend */}
            <div className="flex items-center gap-2 flex-wrap text-xs font-semibold">
              <span className="text-slate-400 uppercase tracking-wide text-xs">Scale:</span>
              {SCORE_OPTIONS.map(({ value, label }) => (
                <span
                  key={value}
                  className="px-2.5 py-0.5 rounded"
                  style={scorePillStyle(value, true)}
                >
                  {value === 0 ? "0" : value === 1 ? "1" : "0.5"} · {label}
                </span>
              ))}
            </div>

            {/* Domain scores per category */}
            {rubricData.categories.map((cat) => (
              <div key={cat.id} className="overflow-hidden rounded-xl shadow-sm border border-slate-100">
                <div
                  className="px-4 py-2.5 font-bold uppercase tracking-wider text-white"
                  style={{ backgroundColor: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: "0.04em" }}
                >
                  {cat.name}
                </div>
                <div className="bg-white divide-y divide-slate-100">
                  {cat.domains.map((domain) => (
                    <div key={domain.id} className="flex items-start gap-3 px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-700">{domain.name}</p>
                        {domain.description && (
                          <p className="text-xs text-slate-400 mt-0.5 leading-snug">{domain.description}</p>
                        )}
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        {SCORE_OPTIONS.map(({ value, label }) => (
                          <button
                            key={value}
                            type="button"
                            title={label}
                            onClick={() => setScores((prev) => ({ ...prev, [domain.slug]: value }))}
                            className="px-2.5 h-9 rounded font-bold text-sm transition-all whitespace-nowrap min-w-[36px]"
                            style={scorePillStyle(value, scores[domain.slug] === value)}
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

            {/* Notes */}
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex flex-col gap-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: "#16a34a" }}>
                  ✦ Teacher Strengths (Glows)
                </label>
                <textarea
                  value={strengths}
                  onChange={(e) => setStrengths(e.target.value)}
                  placeholder="What is this teacher doing well?"
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-300 bg-white text-slate-800"
                  rows={3}
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
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-orange-200 bg-white text-slate-800"
                  rows={3}
                />
              </div>
            </div>

            {submitError && (
              <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-semibold">
                {submitError}
              </div>
            )}
          </form>
        )}
      </div>

      {/* Sticky submit footer */}
      {!isLoading && !isError && teachers && rubricData && (
        <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] bg-white/95 backdrop-blur-sm border-t border-slate-200 px-4 py-3 flex items-center justify-between gap-3 z-40">
          <p className="text-xs text-slate-400">
            {scoredCount === allDomains.length && allDomains.length > 0
              ? "✓ All domains scored"
              : `${scoredCount} of ${allDomains.length} domains scored`}
          </p>
          <button
            type="submit"
            form="obs-form"
            disabled={saving || !teacherId}
            className="px-6 py-2.5 rounded-lg text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm disabled:opacity-50 shrink-0"
            style={{ backgroundColor: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, letterSpacing: "0.04em" }}
          >
            {saving ? <Loader2 size={16} className="animate-spin inline" /> : "Submit Observation"}
          </button>
        </div>
      )}
    </div>
  );
}
