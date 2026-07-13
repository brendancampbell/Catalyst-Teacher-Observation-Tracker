import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useApp } from "@/context/AppContext";
import { AppHeader } from "@/components/AppHeader";
import {
  apiFetch,
  Teacher,
  RubricCategory,
  Score,
  DraftObservation,
  createObservation,
  updateObservation,
  fetchMyDrafts,
} from "@/lib/api";
import { teacherMatchesAudience } from "@/lib/subject-audience";
import { CheckCircle, Loader2, AlertCircle, ChevronDown, FileEdit, CloudOff } from "lucide-react";

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

function localDraftKey(userId: number | undefined, rubricSetId: number | undefined): string {
  return `catalyst-mobile-draft-${userId ?? "anon"}-${rubricSetId ?? "0"}`;
}

interface LocalDraft {
  teacherId: string;
  date: string;
  course: string;
  scores: Partial<Record<string, Score>>;
  strengths: string;
  growthAreas: string;
  isWalkthrough: boolean;
  savedAt: number;
}

export default function ObservationPage() {
  const { user } = useAuth();
  const { selectedSchool, selectedRubric, setSelectedSchool } = useApp();
  const [, navigate] = useLocation();
  const search = useSearch();

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
      const params = new URLSearchParams({ includeInFeedbackTracker: "true" });
      if (effectiveSchoolId != null) params.set("schoolId", String(effectiveSchoolId));
      const all = await apiFetch<(Teacher & { employeeId: string })[]>(`/api/people?${params}`);
      return all.filter((t) => t.isActive).map((t) => ({ ...t, id: t.employeeId }));
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

  const [draftId, setDraftId] = useState<string | null>(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);
  const [localDraftRestored, setLocalDraftRestored] = useState(false);

  const draftIdRef = useRef<string | null>(null);
  const draftJustLoaded = useRef(false);
  const isSubmittingRef = useRef(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { draftIdRef.current = draftId; }, [draftId]);

  const audience = selectedRubric?.subjectAudience ?? "ALL";
  const filteredTeachers = useMemo(
    () => teachers?.filter((t) => teacherMatchesAudience(t.department, audience)) ?? [],
    [teachers, audience],
  );
  const hiddenByAudience = useMemo(() => {
    if (audience === "ALL" || !teachers) return 0;
    return teachers.filter((t) => !teacherMatchesAudience(t.department, audience)).length;
  }, [teachers, audience]);

  useEffect(() => {
    if (filteredTeachers.length > 0 && !teacherId) {
      setTeacherId(filteredTeachers[0].id);
    }
  }, [filteredTeachers]);

  useEffect(() => {
    if (filteredTeachers.length > 0 && !filteredTeachers.find((t) => t.id === teacherId)) {
      setTeacherId(filteredTeachers[0].id);
    }
  }, [filteredTeachers, teacherId]);

  const allDomains = rubricData?.categories.flatMap((c) => c.domains) ?? [];
  const scoredCount = allDomains.filter((d) => scores[d.slug] !== undefined).length;

  function loadDraftIntoForm(draft: DraftObservation) {
    draftJustLoaded.current = true;
    setDate(draft.date);
    setCourse(draft.course ?? "");
    setScores(draft.scores as Partial<Record<string, Score>>);
    setStrengths(draft.strengths ?? "");
    setGrowthAreas(draft.growthAreas ?? "");
    setIsWalkthrough(draft.isWalkthrough);
    setDraftId(draft.id);
    setAutoSaveStatus("saved");
    setLastSavedTime(null);
    setLocalDraftRestored(false);
  }

  const checkForDraft = useCallback(async (forTeacherId: string, rubricSetId: number) => {
    if (!forTeacherId) return;
    try {
      const allDrafts = await fetchMyDrafts();
      const match = allDrafts.find(
        (d) => d.observedEmployeeId === forTeacherId && d.rubricSetId === rubricSetId,
      );
      if (match) {
        loadDraftIntoForm(match);
        return;
      }
    } catch {
      /* silently ignore — draft detection is best-effort */
    }

    const lsKey = localDraftKey(user?.id, rubricSetId);
    try {
      const raw = localStorage.getItem(lsKey);
      if (raw) {
        const ld = JSON.parse(raw) as LocalDraft;
        if (ld.teacherId === forTeacherId) {
          draftJustLoaded.current = true;
          setDate(ld.date);
          setCourse(ld.course);
          setScores(ld.scores);
          setStrengths(ld.strengths);
          setGrowthAreas(ld.growthAreas);
          setIsWalkthrough(ld.isWalkthrough);
          setLocalDraftRestored(true);
        }
      }
    } catch { /* ignore */ }
  }, [user?.id]);

  const resumeDraftIdParam = new URLSearchParams(search).get("draftId");

  const loadDraftById = useCallback(async (id: string) => {
    try {
      const allDrafts = await fetchMyDrafts();
      const match = allDrafts.find((d) => d.id === id);
      if (match) {
        loadDraftIntoForm(match);
      }
    } catch { /* silently ignore */ }
  }, []);

  useEffect(() => {
    if (resumeDraftIdParam && rubricData) {
      loadDraftById(resumeDraftIdParam);
    }
  }, [resumeDraftIdParam, rubricData]);

  useEffect(() => {
    if (!teacherId || !selectedRubric?.id || resumeDraftIdParam) return;
    setDate(todayIso);
    setCourse("");
    setScores({});
    setStrengths("");
    setGrowthAreas("");
    setIsWalkthrough(false);
    setDraftId(null);
    setAutoSaveStatus("idle");
    setLastSavedTime(null);
    setLocalDraftRestored(false);
    checkForDraft(teacherId, selectedRubric.id);
  }, [teacherId]);

  const scoresJson = JSON.stringify(scores);
  useEffect(() => {
    if (!teacherId || !selectedRubric?.id || isSubmittingRef.current) return;
    const hasContent =
      Object.keys(scores).length > 0 ||
      strengths.trim().length > 0 ||
      growthAreas.trim().length > 0;
    if (!hasContent) return;

    if (draftJustLoaded.current) {
      draftJustLoaded.current = false;
      return;
    }

    const lsKey = localDraftKey(user?.id, selectedRubric.id);
    const lsDraft: LocalDraft = {
      teacherId,
      date,
      course,
      scores,
      strengths,
      growthAreas,
      isWalkthrough,
      savedAt: Date.now(),
    };
    try { localStorage.setItem(lsKey, JSON.stringify(lsDraft)); } catch { /* ignore */ }

    setAutoSaveStatus("saving");

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    const timer = setTimeout(async () => {
      if (isSubmittingRef.current) return;
      try {
        const currentDraftId = draftIdRef.current;
        const scoresRecord = scores as Record<string, Score>;
        let savedId: string;
        if (currentDraftId) {
          const obs = await updateObservation(currentDraftId, {
            strengths: strengths || undefined,
            growthAreas: growthAreas || undefined,
            scores: scoresRecord,
            status: "draft",
          });
          savedId = obs.id;
        } else {
          const obs = await createObservation({
            teacherId,
            rubricSetId: selectedRubric.id,
            date,
            course: course || undefined,
            scores: scoresRecord,
            strengths: strengths || undefined,
            growthAreas: growthAreas || undefined,
            observer: user?.name,
            observerId: user?.id,
            isWalkthrough,
            status: "draft",
          });
          savedId = obs.id;
          setDraftId(savedId);
        }
        const now = new Date();
        const t = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
        setAutoSaveStatus("saved");
        setLastSavedTime(t);
        setLocalDraftRestored(false);
      } catch {
        setAutoSaveStatus("error");
      }
    }, 2000);

    autoSaveTimerRef.current = timer;
    return () => {
      clearTimeout(timer);
      autoSaveTimerRef.current = null;
    };
  }, [teacherId, date, course, scoresJson, strengths, growthAreas, isWalkthrough]);

  function clearLocalDraft() {
    if (!user?.id || !selectedRubric?.id) return;
    try { localStorage.removeItem(localDraftKey(user.id, selectedRubric.id)); } catch { /* ignore */ }
  }

  function resetForm() {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    isSubmittingRef.current = false;
    setDraftId(null);
    setAutoSaveStatus("idle");
    setLastSavedTime(null);
    setLocalDraftRestored(false);
    setTeacherId(filteredTeachers[0]?.id ?? "");
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
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    setSaving(true);
    isSubmittingRef.current = true;
    setSubmitError(null);
    try {
      const currentDraftId = draftIdRef.current;
      if (currentDraftId) {
        await updateObservation(currentDraftId, {
          strengths: strengths || undefined,
          growthAreas: growthAreas || undefined,
          scores: scores as Record<string, Score>,
          status: "published",
        });
      } else {
        await apiFetch("/api/observations", {
          method: "POST",
          body: JSON.stringify({
            observedEmployeeId: teacherId,
            rubricSetId: selectedRubric.id,
            date,
            course: course || null,
            strengths: strengths || null,
            growthAreas: growthAreas || null,
            scores: Object.fromEntries(Object.entries(scores).filter(([, v]) => v !== undefined)),
            isWalkthrough,
          }),
        });
      }
      clearLocalDraft();
      setConfirmed(true);
      setTimeout(() => {
        setConfirmed(false);
        resetForm();
      }, 2500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save observation";
      setSubmitError(msg);
      isSubmittingRef.current = false;
    } finally {
      setSaving(false);
    }
  }

  function handleSwitchSchool() {
    setSelectedSchool(null);
    navigate("/school-picker");
  }

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const schoolName = selectedSchool?.displayName ?? user?.schoolName ?? undefined;
  const subtitle = [schoolName, selectedRubric?.name].filter(Boolean).join(" · ");

  const isLoading = loadingTeachers || loadingRubric;
  const isError = errorTeachers || errorRubric;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <AppHeader
        subtitle={subtitle}
        onSwitchSchool={isNetworkScope ? handleSwitchSchool : undefined}
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

            {/* No-teachers notice */}
            {filteredTeachers.length === 0 && audience !== "ALL" && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200">
                <AlertCircle size={18} className="shrink-0 mt-0.5 text-amber-500" />
                <p className="text-sm text-amber-800 leading-snug">
                  No teachers match this rubric's audience. Switch to an All-audience rubric or update teacher subjects.
                </p>
              </div>
            )}

            {/* Hidden-teachers notice */}
            {hiddenByAudience > 0 && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-xl border" style={{ backgroundColor: "#FFF8E6", borderColor: "#F5C842" }}>
                <AlertCircle size={18} className="shrink-0 mt-0.5" style={{ color: "#B45309" }} />
                <p className="text-sm leading-snug" style={{ color: "#7A5C00" }}>
                  {hiddenByAudience === 1 ? "1 teacher is hidden" : `${hiddenByAudience} teachers are hidden`}
                  {" — this rubric is for "}
                  <strong>{audience === "STEM" ? "STEM" : "Humanities"}</strong>
                  {" teachers only. Switch to an "}
                  <strong>All Teachers</strong>
                  {" rubric to see everyone."}
                </p>
              </div>
            )}

            {/* Local-only draft banner */}
            {localDraftRestored && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-amber-300 bg-amber-50">
                <CloudOff size={18} className="shrink-0 mt-0.5 text-amber-600" />
                <p className="text-sm text-amber-800 leading-snug">
                  Restored from a local backup (saved before a sync error). Continue editing — it will sync now.
                </p>
              </div>
            )}

            {/* Teacher + Date */}
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex flex-col gap-3">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">Teacher</label>
                <div className="relative">
                  <select
                    value={teacherId}
                    onChange={(e) => setTeacherId(e.target.value)}
                    required
                    disabled={filteredTeachers.length === 0}
                    className="w-full appearance-none px-3 py-2.5 pr-9 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 bg-white text-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ fontFamily: "'Libre Franklin', sans-serif" }}
                  >
                    <option value="" disabled>Select a teacher…</option>
                    {filteredTeachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.department ?? ""}{ t.department && t.gradeLevel?.length ? ", " : ""}{t.gradeLevel?.length ? `Gr. ${t.gradeLevel.join("/")}` : ""})
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
                            onClick={() => setScores((prev) => ({ ...prev, [domain.slug]: prev[domain.slug] === value ? undefined : value }))}
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
        <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] bg-white/95 backdrop-blur-sm border-t border-slate-200 px-4 py-3 z-40">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-0.5 min-w-0">
              <p className="text-xs text-slate-400 truncate">
                {scoredCount === allDomains.length && allDomains.length > 0
                  ? "✓ All domains scored"
                  : `${scoredCount} of ${allDomains.length} domains scored`}
              </p>
              <div className="flex items-center gap-2">
                {autoSaveStatus === "saving" && (
                  <span className="text-xs text-slate-400 flex items-center gap-1">
                    <Loader2 size={10} className="animate-spin" /> Saving…
                  </span>
                )}
                {autoSaveStatus === "saved" && (
                  <span className="text-xs text-green-600 flex items-center gap-1">
                    <CheckCircle size={10} />
                    {lastSavedTime ? `Saved ${lastSavedTime}` : "Draft saved"}
                  </span>
                )}
                {autoSaveStatus === "error" && (
                  <span className="text-xs text-amber-600 flex items-center gap-1">
                    <CloudOff size={10} /> Backed up locally
                  </span>
                )}
                {autoSaveStatus === "idle" && (
                  <a
                    href={`${basePath}/drafts`}
                    className="text-xs font-semibold flex items-center gap-1"
                    style={{ color: NAVY }}
                  >
                    <FileEdit size={11} /> My Drafts
                  </a>
                )}
              </div>
            </div>
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
        </div>
      )}
    </div>
  );
}
