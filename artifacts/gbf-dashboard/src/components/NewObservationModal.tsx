import { useState, useEffect } from "react";
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
  canMarkWalkthrough?: boolean;
  defaultTeacherId?: string;
  defaultIsWalkthrough?: boolean;
  observerName?: string;
  onSubmit: (
    teacherId: string,
    date: string,
    scores: Record<string, Score>,
    strengths: string,
    growthAreas: string,
    isWalkthrough: boolean,
    time: string,
    course: string,
  ) => void;
  saving?: boolean;
}

const SCORE_OPTIONS: { value: Score; label: string }[] = [
  { value: 0,   label: "Not Yet" },
  { value: 0.5, label: "Developing" },
  { value: 1,   label: "Proficient" },
];

function scorePillClass(s: Score, selected: boolean): string {
  if (!selected) return "bg-slate-100 text-slate-400 hover:bg-slate-200 border border-slate-200";
  if (s >= 1)   return "bg-green-600 text-white border-2 border-green-500 shadow-sm";
  if (s >= 0.5) return "bg-yellow-300 text-yellow-900 border-2 border-yellow-400 shadow-sm";
  return "bg-red-300 text-red-900 border-2 border-red-400 shadow-sm";
}

const SCORE_LABEL: Record<string, string> = { "0": "Not Yet", "0.5": "Developing", "1": "Proficient" };

function formatDateLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export function NewObservationModal({ teachers, categories, allDomains, open, onOpenChange, canMarkWalkthrough, defaultTeacherId, defaultIsWalkthrough, observerName, onSubmit, saving }: Props) {
  const todayIso = new Date().toISOString().split("T")[0];

  const nowTime = () => {
    const n = new Date();
    return `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`;
  };

  const [teacherId, setTeacherId] = useState(defaultTeacherId ?? teachers[0]?.id ?? "");
  const [date, setDate] = useState(todayIso);
  const [time, setTime] = useState(nowTime);
  const [course, setCourse] = useState("");
  const [scores, setScores] = useState<Partial<Record<string, Score>>>({});
  const [strengths, setStrengths] = useState("");
  const [growthAreas, setGrowthAreas] = useState("");
  const [isWalkthrough, setIsWalkthrough] = useState(false);
  const [emailFeedback, setEmailFeedback] = useState(false);
  const [emailPreview, setEmailPreview] = useState<{ subject: string; body: string; mailtoUrl: string; outlookWebUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setTeacherId(defaultTeacherId ?? teachers[0]?.id ?? "");
      setDate(new Date().toISOString().split("T")[0]);
      setTime(nowTime());
      setCourse("");
      setScores({});
      setStrengths("");
      setGrowthAreas("");
      setIsWalkthrough(!!defaultIsWalkthrough);
      setEmailFeedback(false);
    }
  }, [open, defaultTeacherId, defaultIsWalkthrough]); // eslint-disable-line react-hooks/exhaustive-deps

  const scoredCount = allDomains.filter((d) => scores[d.id] !== undefined).length;

  function reset() {
    setTeacherId(defaultTeacherId ?? teachers[0]?.id ?? "");
    setDate(todayIso);
    setTime(nowTime());
    setCourse("");
    setScores({});
    setStrengths("");
    setGrowthAreas("");
    setIsWalkthrough(false);
    setEmailFeedback(false);
    setEmailPreview(null);
    setCopied(false);
  }

  function buildEmailDraft(): { subject: string; body: string; gmailUrl: string } {
    const teacher = teachers.find((t) => t.id === teacherId);
    const firstName = teacher?.name.split(" ")[0] ?? "Teacher";
    const dateLabel = formatDateLong(date);
    const observer = observerName ?? "Your Observer";

    const nl = "\n";
    const divider = "─".repeat(48);

    let scoreBlock = "";
    for (const cat of categories) {
      scoreBlock += `${nl}${cat.label.toUpperCase()}${nl}`;
      let catTotal = 0, catCount = 0;
      for (const domain of cat.domains) {
        const raw = scores[domain.id];
        const scoreStr = raw !== undefined ? String(raw) : undefined;
        const label = scoreStr !== undefined ? `${scoreStr}  (${SCORE_LABEL[scoreStr] ?? scoreStr})` : "—";
        scoreBlock += `  ${domain.label.padEnd(32)} ${label}${nl}`;
        if (raw !== undefined) { catTotal += raw; catCount++; }
      }
      if (catCount > 0) {
        scoreBlock += `  ${"Sub-average".padEnd(32)} ${(catTotal / catCount).toFixed(1)}${nl}`;
      }
    }

    const scoredVals = allDomains.map((d) => scores[d.id]).filter((v): v is Score => v !== undefined);
    const overallAvg = scoredVals.length ? (scoredVals.reduce((a, b) => a + b, 0) / scoredVals.length).toFixed(1) : "—";

    const body = [
      `Dear ${firstName},`,
      nl,
      `Thank you for your continued commitment to your students. I wanted to share feedback from my recent observation of your classroom. I hope these notes are helpful as you continue to grow in your practice.`,
      nl,
      `Warm regards,`,
      observer,
      nl,
      divider,
      `OBSERVATION DETAILS`,
      divider,
      `Date:      ${dateLabel}`,
      `Observer:  ${observer}`,
      `Teacher:   ${teacher?.name ?? ""}`,
      `Subject:   ${teacher?.subject ?? ""}  ·  Grade${(teacher?.gradeLevel.length ?? 0) !== 1 ? "s" : ""} ${teacher?.gradeLevel.join(", ") ?? ""}`,
      nl,
      divider,
      `RUBRIC SCORES`,
      divider,
      scoreBlock.trimEnd(),
      nl,
      `${"Overall Average".padEnd(32)} ${overallAvg}`,
      nl,
      divider,
      `GLOWS (Teacher Strengths)`,
      divider,
      strengths.trim() || "(none entered)",
      nl,
      divider,
      `GROWS (Growth Areas)`,
      divider,
      growthAreas.trim() || "(none entered)",
    ].join(nl);

    const subject = `Classroom Observation Feedback - ${dateLabel}`;
    const mailtoUrl = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    const outlookWebUrl = `https://outlook.office.com/mail/deeplink/compose?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    return { subject, body, mailtoUrl, outlookWebUrl };
  }

  function handleSubmit() {
    if (!teacherId) return;
    onSubmit(teacherId, date, scores as Record<string, Score>, strengths, growthAreas, isWalkthrough, time, course);
    if (emailFeedback) {
      setEmailPreview(buildEmailDraft());
    } else {
      reset();
      onOpenChange(false);
    }
  }

  function handleCopy(body: string) {
    navigator.clipboard.writeText(body).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  const inputBase =
    "w-full px-3 py-2 rounded border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed z-50 flex flex-col bg-white shadow-2xl overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 inset-x-2 inset-y-3 rounded-xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-full sm:max-w-2xl sm:max-h-[74vh]">

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

          {/* ── Email Preview Screen ──────────────────────── */}
          {emailPreview && (
            <>
              <div className="overflow-y-auto flex-1 px-6 py-5 flex flex-col gap-4" style={{ fontFamily: "'Libre Franklin', sans-serif" }}>
                <div className="flex items-center gap-2">
                  <span className="text-2xl">✉</span>
                  <div>
                    <p className="font-bold text-slate-700">Observation saved!</p>
                    <p className="text-sm text-slate-500">Your email draft is ready — open in Outlook or copy and paste.</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Subject</p>
                  <div className="px-3 py-2 rounded border border-slate-200 text-sm bg-slate-50 text-slate-700">{emailPreview.subject}</div>
                </div>
                <div className="flex-1 flex flex-col min-h-0">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Body</p>
                  <textarea
                    readOnly
                    value={emailPreview.body}
                    className="flex-1 w-full px-3 py-2 rounded border border-slate-200 text-sm bg-slate-50 text-slate-700 resize-none focus:outline-none font-mono"
                    style={{ minHeight: 180 }}
                  />
                </div>
              </div>
              <div className="shrink-0 px-4 sm:px-6 py-3 sm:py-4 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-end gap-2 sm:gap-3 bg-slate-50">
                <button
                  type="button"
                  onClick={() => handleCopy(emailPreview.body)}
                  className="flex-1 sm:flex-none px-4 sm:px-5 py-2 rounded text-sm font-semibold border transition-colors text-center"
                  style={{ borderColor: NAVY, color: copied ? "#15803d" : NAVY, backgroundColor: copied ? "#f0fdf4" : "white" }}
                >
                  {copied ? "✓ Copied!" : "Copy to Clipboard"}
                </button>
                <a
                  href={emailPreview.outlookWebUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 sm:flex-none px-4 sm:px-5 py-2 rounded text-sm font-bold text-white text-center transition-opacity hover:opacity-90"
                  style={{ backgroundColor: "#0078D4", textDecoration: "none" }}
                >
                  Outlook Web
                </a>
                <a
                  href={emailPreview.mailtoUrl}
                  className="flex-1 sm:flex-none px-4 sm:px-5 py-2 rounded text-sm font-bold text-white text-center transition-opacity hover:opacity-90"
                  style={{ backgroundColor: "#0078D4", textDecoration: "none", opacity: 0.85 }}
                  onClick={() => { setTimeout(() => { reset(); onOpenChange(false); }, 400); }}
                >
                  Open in Outlook
                </a>
                <button
                  type="button"
                  onClick={() => { reset(); onOpenChange(false); }}
                  className="flex-1 sm:flex-none px-4 sm:px-6 py-2 rounded text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm"
                  style={{ backgroundColor: NAVY }}
                >
                  Done
                </button>
              </div>
            </>
          )}

          {/* ── Form (hidden when showing email preview) ───── */}
          {!emailPreview && (<><div className="overflow-y-auto flex-1 px-6 py-5 space-y-5" style={{ fontFamily: "'Libre Franklin', sans-serif" }}>

            {/* Subject / Course */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Subject / Course Being Observed
              </label>
              <input
                type="text"
                value={course}
                onChange={(e) => setCourse(e.target.value)}
                placeholder="e.g. AP Biology, 8th Grade Math, ELA Block 2…"
                className={inputBase}
              />
            </div>

            {/* Teacher + Date + Time */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              <div className="sm:col-span-1">
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
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                  Time
                </label>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className={inputBase}
                />
              </div>
            </div>

            {/* Walkthrough / Rescore toggle */}
            {canMarkWalkthrough && (
              <div
                className="flex items-center justify-between px-4 py-3 rounded-lg"
                style={{ backgroundColor: isWalkthrough ? "#EEF1FB" : "#f8fafc", border: `1.5px solid ${isWalkthrough ? NAVY : "#dde3f0"}` }}
              >
                <div>
                  <p className="font-bold text-sm" style={{ color: NAVY }}>Walkthrough / Rescore</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Count this as an official walkthrough or rescore. Teachers averaging below 0.7 will be added to the rescore queue.
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
                  {cat.domains.map((domain) => {
                    return (
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
                              onClick={() => setScores((prev) => ({ ...prev, [domain.id]: value }))}
                              className={`px-3 h-9 rounded font-bold text-sm transition-all whitespace-nowrap ${scorePillClass(value, scores[domain.id] === value)}`}
                            >
                              {value === 0 ? "0" : value === 1 ? "1" : "0.5"}
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

            {/* Email Teacher Feedback toggle */}
            <div
              className="flex items-center justify-between px-4 py-3 rounded-lg"
              style={{ backgroundColor: emailFeedback ? "#f0fdf4" : "#f8fafc", border: `1.5px solid ${emailFeedback ? "#16a34a" : "#dde3f0"}` }}
            >
              <div>
                <p className="font-bold text-sm" style={{ color: emailFeedback ? "#15803d" : "#374151" }}>✉ Email Teacher Feedback</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  After submitting, open a draft email with rubric scores, glows, and grows pre-filled.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={emailFeedback}
                onClick={() => setEmailFeedback((v) => !v)}
                className="relative shrink-0 ml-4 w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-300"
                style={{ backgroundColor: emailFeedback ? "#16a34a" : "#cbd5e1" }}
              >
                <span
                  className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200"
                  style={{ transform: emailFeedback ? "translateX(20px)" : "translateX(0)" }}
                />
              </button>
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
                {saving ? "Saving…" : "Submit"}
              </button>
            </div>
          </div>
          </>)}

        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
