import { useState, useEffect, useMemo } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X, Plus } from "lucide-react";
import { type Score, type Teacher } from "@/data/dummy";
import type { CategoryEntry, DomainEntry } from "@/lib/api";
import { sendObservationEmail } from "@/lib/api";
import { toast } from "@/hooks/use-toast";

const NAVY = "#1034B4";
const YELLOW = "#FFB500";

// Direct email send is gated off until the Resend sending domain is verified.
// Flip to `true` when the Resend connector is fully configured and the
// sending domain is verified. See replit.md → "Email sending".
const EMAIL_DIRECT_SEND_ENABLED = false;

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
  ) => Promise<string>;
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
  const [emailPreview, setEmailPreview] = useState<{ subject: string; body: string; htmlEmail: string; mailtoUrl: string; outlookWebUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedHtml, setCopiedHtml] = useState(false);
  const [editableIntro, setEditableIntro] = useState("");
  const [editableGlows, setEditableGlows] = useState("");
  const [editableGrows, setEditableGrows] = useState("");
  const [emailTab, setEmailTab] = useState<"preview" | "edit">("edit");
  const [editableSubject, setEditableSubject] = useState("");
  const [savedObsId, setSavedObsId] = useState<string | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailSendError, setEmailSendError] = useState<string | null>(null);
  const [outlookHint, setOutlookHint] = useState(false);
  const [emailMode, setEmailMode] = useState<"all" | "scored" | "glows">("all");

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
    setCopiedHtml(false);
    setEditableSubject("");
    setEditableIntro("");
    setEditableGlows("");
    setEditableGrows("");
    setEmailTab("edit");
    setSavedObsId(null);
    setSendingEmail(false);
    setEmailSent(false);
    setEmailSendError(null);
    setOutlookHint(false);
    setEmailMode("all");
  }

  function buildEmailDraft(introText?: string, mode: "all" | "scored" | "glows" = emailMode): { subject: string; body: string; mailtoUrl: string; outlookWebUrl: string } {
    const teacher = teachers.find((t) => t.id === teacherId);
    const firstName = teacher?.firstName || teacher?.name.split(" ")[0] || "Teacher";
    const dateLabel = formatDateLong(date);
    const observer = observerName ?? "Your Observer";

    const nl = "\n";
    const divider = "─".repeat(48);

    let scoreBlock = "";
    if (mode !== "glows") {
      for (const cat of categories) {
        const domainsToShow = mode === "scored"
          ? cat.domains.filter((d) => scores[d.id] !== undefined)
          : cat.domains;
        if (domainsToShow.length === 0) continue;
        scoreBlock += `${nl}${cat.label.toUpperCase()}${nl}`;
        let catTotal = 0, catCount = 0;
        for (const domain of domainsToShow) {
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
    }

    const scoredVals = allDomains.map((d) => scores[d.id]).filter((v): v is Score => v !== undefined);
    const overallAvg = scoredVals.length ? (scoredVals.reduce((a, b) => a + b, 0) / scoredVals.length).toFixed(1) : "—";

    const resolvedIntro = introText ?? `Dear ${firstName},\n\n${DEFAULT_INTRO_BODY}\n\nWarm regards,\n${observer}`;

    const rubricLines = mode !== "glows" && scoreBlock.trim() ? [
      divider,
      `RUBRIC SCORES`,
      divider,
      scoreBlock.trimEnd(),
      nl,
      `${"Overall Average".padEnd(32)} ${overallAvg}`,
      nl,
    ] : [];

    const body = [
      resolvedIntro,
      nl,
      divider,
      `OBSERVATION DETAILS`,
      divider,
      `Date:      ${dateLabel}`,
      `Observer:  ${observer}`,
      `Teacher:   ${teacher?.name ?? ""}`,
      `Subject:   ${teacher?.subject ?? ""}  ·  Grade${(teacher?.gradeLevel.length ?? 0) !== 1 ? "s" : ""} ${teacher?.gradeLevel.join(", ") ?? ""}`,
      nl,
      ...rubricLines,
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
    const teacherEmail = teacher?.email ?? "";
    const mailtoUrl = `mailto:${encodeURIComponent(teacherEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    const outlookWebUrl = `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(teacherEmail)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    return { subject, body, mailtoUrl, outlookWebUrl };
  }

  function buildHtmlEmail(intro: string, glowsText: string, growsText: string, mode: "all" | "scored" | "glows" = emailMode): string {
    const teacher = teachers.find((t) => t.id === teacherId);
    const firstName = teacher?.firstName || teacher?.name.split(" ")[0] || "Teacher";
    const dateLabel = formatDateLong(date);
    const observer = observerName ?? "Your Observer";
    const logoUrl = `${window.location.origin}/uncommon-logo-white.png`;
    const logoStyle = "display:block;height:36px;max-width:180px;";

    const scoredVals = allDomains.map((d) => scores[d.id]).filter((v): v is Score => v !== undefined);
    const overallAvg = scoredVals.length
      ? (scoredVals.reduce((a, b) => a + b, 0) / scoredVals.length).toFixed(2)
      : null;

    function scoreBg(val: Score | undefined): string {
      if (val === undefined) return "#e2e8f0";
      if (val >= 1) return "#16a34a";
      if (val >= 0.5) return "#ca8a04";
      return "#dc2626";
    }
    function scoreColor(val: Score | undefined): string {
      if (val === undefined) return "#94a3b8";
      return "#ffffff";
    }
    function scoreText(val: Score | undefined): string {
      if (val === undefined) return "—";
      return val === 0.5 ? "0.5" : String(val);
    }

    // Trend: compare current scores to most recent prior observation for this teacher
    const prevObs = (teachers.find((t) => t.id === teacherId)?.observations ?? [])
      .slice()
      .sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));

    function trendHtml(domainId: string, currentVal: Score | undefined): string {
      if (currentVal === undefined) return `<span style="color:#cbd5e1;font-size:14px;">—</span>`;
      const prior = prevObs.find((o) => o.scores[domainId] !== undefined);
      if (!prior) return `<span style="color:#94a3b8;font-size:13px;" title="First observation">New</span>`;
      const prevVal = prior.scores[domainId] as Score;
      if (currentVal > prevVal)
        return `<span style="color:#16a34a;font-size:18px;font-weight:900;line-height:1;">↑</span>`;
      if (currentVal < prevVal)
        return `<span style="color:#dc2626;font-size:18px;font-weight:900;line-height:1;">↓</span>`;
      return `<span style="color:#94a3b8;font-size:18px;font-weight:700;line-height:1;">→</span>`;
    }

    let scoreTableRows = "";
    if (mode !== "glows") {
      for (const cat of categories) {
        const domainsToShow = mode === "scored"
          ? cat.domains.filter((d) => scores[d.id] !== undefined)
          : cat.domains;
        if (domainsToShow.length === 0) continue;
        scoreTableRows += `
        <tr>
          <td colspan="3" style="background:#1034B4;color:#fff;font-family:'Bebas Neue',Arial,sans-serif;font-size:15px;letter-spacing:0.06em;padding:8px 14px;text-transform:uppercase;">${cat.label}</td>
        </tr>`;
        let catTotal = 0, catCount = 0;
        for (const domain of domainsToShow) {
          const val = scores[domain.id] as Score | undefined;
          const bg = scoreBg(val);
          const fg = scoreColor(val);
          const txt = scoreText(val);
          scoreTableRows += `
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:8px 14px;font-size:13px;color:#374151;">${domain.label}</td>
          <td style="padding:8px 6px;text-align:center;">
            <span style="display:inline-block;background:${bg};color:${fg};border-radius:4px;padding:2px 10px;font-size:12px;font-weight:700;min-width:32px;">${txt}</span>
          </td>
          <td style="padding:8px 10px;text-align:center;">${trendHtml(domain.id, val)}</td>
        </tr>`;
          if (val !== undefined) { catTotal += val; catCount++; }
        }
        if (catCount > 0) {
          const avg = (catTotal / catCount).toFixed(2);
          scoreTableRows += `
        <tr style="background:#f8fafc;border-bottom:2px solid #dde3f0;">
          <td style="padding:7px 14px;font-size:12px;font-weight:700;color:#374151;font-style:italic;">Sub-average</td>
          <td style="padding:7px 6px;text-align:center;font-size:12px;font-weight:700;color:#374151;">${avg}</td>
          <td></td>
        </tr>`;
        }
      }
      if (overallAvg !== null && scoreTableRows.trim()) {
        scoreTableRows += `
        <tr style="background:#1034B4;">
          <td style="padding:9px 14px;font-size:13px;font-weight:700;color:#fff;">Overall Average</td>
          <td style="padding:9px 6px;text-align:center;font-size:14px;font-weight:700;color:#FFB500;">${overallAvg}</td>
          <td></td>
        </tr>`;
      }
    }

    const gradeLabel = `Grade${(teacher?.gradeLevel.length ?? 0) !== 1 ? "s" : ""} ${teacher?.gradeLevel.join(", ") ?? ""}`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Observation Feedback</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Libre Franklin',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

      <!-- Header -->
      <tr>
        <td style="background:#1034B4;padding:20px 28px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <img src="${logoUrl}" alt="Uncommon Schools" height="36" style="${logoStyle}"/>
              </td>
              <td align="right" style="color:#bfcbf7;font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;vertical-align:middle;">
                Observation Feedback
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Yellow accent bar -->
      <tr><td style="background:#FFB500;height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>

      <!-- Greeting -->
      <tr>
        <td style="padding:28px 28px 0 28px;">
          <p style="margin:0;font-size:14px;color:#475569;line-height:1.6;">${intro.replace(/\n/g, "<br/>")}</p>
        </td>
      </tr>

      <!-- Observation Details -->
      <tr>
        <td style="padding:24px 28px 0 28px;">
          <p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;">Observation Details</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
            <tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:8px 14px;font-size:12px;font-weight:700;color:#64748b;width:110px;background:#f8fafc;">Date</td>
              <td style="padding:8px 14px;font-size:13px;color:#1e293b;">${dateLabel}</td>
            </tr>
            <tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:8px 14px;font-size:12px;font-weight:700;color:#64748b;background:#f8fafc;">Time</td>
              <td style="padding:8px 14px;font-size:13px;color:#1e293b;">${time}</td>
            </tr>
            <tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:8px 14px;font-size:12px;font-weight:700;color:#64748b;background:#f8fafc;">Observer</td>
              <td style="padding:8px 14px;font-size:13px;color:#1e293b;">${observer}</td>
            </tr>
            <tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:8px 14px;font-size:12px;font-weight:700;color:#64748b;background:#f8fafc;">Teacher</td>
              <td style="padding:8px 14px;font-size:13px;color:#1e293b;">${teacher?.name ?? ""}</td>
            </tr>
            <tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:8px 14px;font-size:12px;font-weight:700;color:#64748b;background:#f8fafc;">Subject</td>
              <td style="padding:8px 14px;font-size:13px;color:#1e293b;">${teacher?.subject ?? ""}</td>
            </tr>
            <tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:8px 14px;font-size:12px;font-weight:700;color:#64748b;background:#f8fafc;">Grade</td>
              <td style="padding:8px 14px;font-size:13px;color:#1e293b;">${gradeLabel}</td>
            </tr>
            ${course ? `<tr>
              <td style="padding:8px 14px;font-size:12px;font-weight:700;color:#64748b;background:#f8fafc;">Course</td>
              <td style="padding:8px 14px;font-size:13px;color:#1e293b;">${course}</td>
            </tr>` : ""}
          </table>
        </td>
      </tr>

      ${scoreTableRows.trim() ? `
      <!-- Rubric Scores -->
      <tr>
        <td style="padding:24px 28px 0 28px;">
          <p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;">Rubric Scores</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
            <thead>
              <tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">
                <th style="padding:7px 14px;font-size:11px;font-weight:700;text-align:left;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Domain</th>
                <th style="padding:7px 6px;font-size:11px;font-weight:700;text-align:center;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;width:60px;">Score</th>
                <th style="padding:7px 14px;font-size:11px;font-weight:700;text-align:center;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;width:80px;">Trend</th>
              </tr>
            </thead>
            <tbody>
              ${scoreTableRows}
            </tbody>
          </table>
        </td>
      </tr>` : ""}

      <!-- Glows -->
      <tr>
        <td style="padding:24px 28px 0 28px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;">
            <tr>
              <td style="padding:14px 16px;">
                <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#16a34a;">✦ Teacher Strengths (Glows)</p>
                <p style="margin:0;font-size:13px;color:#166534;line-height:1.6;white-space:pre-wrap;">${glowsText.trim() || "(none entered)"}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Grows -->
      <tr>
        <td style="padding:16px 28px 0 28px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;">
            <tr>
              <td style="padding:14px 16px;">
                <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#ea580c;">↑ Growth Areas (Grows)</p>
                <p style="margin:0;font-size:13px;color:#9a3412;line-height:1.6;white-space:pre-wrap;">${growsText.trim() || "(none entered)"}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Spacer -->
      <tr><td style="height:24px;font-size:0;line-height:0;">&nbsp;</td></tr>

      <!-- Footer -->
      <tr>
        <td style="padding:24px 28px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:11px;color:#94a3b8;text-align:center;">&copy; ${new Date().getFullYear()} Uncommon Schools, Inc.</p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
  }

  const DEFAULT_INTRO_BODY = `Thank you for your continued commitment to your students. I wanted to share feedback from my recent observation of your classroom. I hope these notes are helpful as you continue to grow in your practice.`;

  async function handleSubmit() {
    if (!teacherId) return;
    const obsId = await onSubmit(teacherId, date, scores as Record<string, Score>, strengths, growthAreas, isWalkthrough, time, course);
    setSavedObsId(obsId ?? null);
    if (emailFeedback) {
      const _t = teachers.find((t) => t.id === teacherId);
      const firstName = _t?.firstName || _t?.name.split(" ")[0] || "Teacher";
      const observer = observerName ?? "Your Observer";
      const intro = `Dear ${firstName},\n\n${DEFAULT_INTRO_BODY}\n\nWarm regards,\n${observer}`;
      const glows = strengths;
      const grows = growthAreas;
      setEditableIntro(intro);
      setEditableGlows(glows);
      setEditableGrows(grows);
      const draft = buildEmailDraft(intro);
      const htmlEmail = buildHtmlEmail(intro, glows, grows);
      setEditableSubject(draft.subject);
      setEmailPreview({ ...draft, htmlEmail });
    } else {
      reset();
      onOpenChange(false);
    }
  }

  async function handleSendEmail() {
    if (!savedObsId) return;
    const teacher = teachers.find((t) => t.id === teacherId);
    if (!teacher?.email) return;
    setSendingEmail(true);
    setEmailSendError(null);
    try {
      await sendObservationEmail({
        observationId: savedObsId,
        intro: editableIntro,
        glows: editableGlows,
        grows: editableGrows,
        subject: editableSubject,
        teacherEmail: teacher.email,
        logoUrl: `${window.location.origin}/uncommon-logo-white.png`,
      });
      setEmailSent(true);
      const teacherFirstName = teacher.firstName || teacher.name.split(" ")[0];
      toast({
        title: "Email sent",
        description: `Email sent to ${teacherFirstName}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send email";
      setEmailSendError(message);
      toast({
        title: "Failed to send email",
        description: message,
        variant: "destructive",
      });
    } finally {
      setSendingEmail(false);
    }
  }

  function handleCopy(body: string) {
    navigator.clipboard.writeText(body).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  async function writeRichHtmlToClipboard(html: string): Promise<void> {
    const plain = livePlainBody || html.replace(/<[^>]+>/g, "");

    // 1. Modern Clipboard API — writes both text/html and text/plain
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html":  new Blob([html],  { type: "text/html"  }),
            "text/plain": new Blob([plain], { type: "text/plain" }),
          }),
        ]);
        return;
      } catch { /* fall through */ }
    }

    // 2. contenteditable + execCommand — copies rendered DOM so rich formatting is preserved
    try {
      const div = document.createElement("div");
      div.contentEditable = "true";
      div.innerHTML = html;
      Object.assign(div.style, {
        position: "fixed", top: "0", left: "0",
        width: "1px", height: "1px",
        opacity: "0", pointerEvents: "none", overflow: "hidden",
      });
      document.body.appendChild(div);
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(div);
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.execCommand("copy");
      sel?.removeAllRanges();
      document.body.removeChild(div);
      return;
    } catch { /* fall through */ }

    // 3. Last resort — raw HTML markup as plain text
    await navigator.clipboard.writeText(html);
  }

  async function handleCopyHtml(html: string) {
    try { await writeRichHtmlToClipboard(html); } catch { /* ignore */ }
    setCopiedHtml(true);
    setTimeout(() => setCopiedHtml(false), 3500);
  }

  async function handleOpenOutlook(outlookUrl: string) {
    try { await writeRichHtmlToClipboard(liveHtmlEmail); } catch { /* ignore */ }
    window.open(outlookUrl, "_blank", "noopener,noreferrer");
    setOutlookHint(true);
    setTimeout(() => setOutlookHint(false), 10000);
  }

  // Recomputes whenever the editable text fields change
  const liveHtmlEmail = useMemo(
    () => emailPreview ? buildHtmlEmail(editableIntro, editableGlows, editableGrows, emailMode) : "",
    [emailPreview, editableIntro, editableGlows, editableGrows, emailMode], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Plain-text body for mailto/Outlook links — stays in sync with editable intro
  const livePlainBody = useMemo(
    () => emailPreview ? buildEmailDraft(editableIntro, emailMode).body : "",
    [emailPreview, editableIntro, emailMode], // eslint-disable-line react-hooks/exhaustive-deps
  );

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
              <div className="overflow-y-auto flex-1 flex flex-col gap-3 px-6 py-4" style={{ fontFamily: "'Libre Franklin', sans-serif" }}>

                {/* Header row */}
                <div className="flex items-center justify-between gap-3 shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">✉</span>
                    <div>
                      <p className="font-bold text-slate-700 text-sm leading-snug">Observation saved!</p>
                      <p className="text-slate-500 text-xs mt-0.5 leading-snug">Edit the opening below, then copy or send in Outlook.</p>
                    </div>
                  </div>
                  {/* Edit / Preview tabs */}
                  <div className="flex rounded overflow-hidden border shrink-0" style={{ borderColor: NAVY }}>
                    {(["edit", "preview"] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setEmailTab(tab)}
                        className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors"
                        style={{
                          backgroundColor: emailTab === tab ? NAVY : "white",
                          color: emailTab === tab ? "white" : NAVY,
                        }}
                      >
                        {tab === "edit" ? "Edit Opening" : "Preview"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Edit tab — subject + opening only */}
                {emailTab === "edit" && (
                  <div className="flex flex-col gap-4 flex-1">
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                          Subject Line
                        </label>
                        <input
                          type="text"
                          value={editableSubject}
                          onChange={(e) => setEditableSubject(e.target.value)}
                          className="w-full px-3 py-2 rounded border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
                          style={{ fontFamily: "'Libre Franklin', sans-serif" }}
                        />
                      </div>
                      <div className="shrink-0">
                        <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                          Include Scores
                        </label>
                        <select
                          value={emailMode}
                          onChange={(e) => setEmailMode(e.target.value as "all" | "scored" | "glows")}
                          className="px-3 py-2 rounded border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
                          style={{ fontFamily: "'Libre Franklin', sans-serif" }}
                        >
                          <option value="all">All Rubric Rows</option>
                          <option value="scored">Scored Rows Only</option>
                          <option value="glows">Glows / Grows Only</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex-1 flex flex-col">
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                        Opening Message (Salutation, Body &amp; Signature)
                      </label>
                      <textarea
                        value={editableIntro}
                        onChange={(e) => setEditableIntro(e.target.value)}
                        className="w-full flex-1 px-3 py-2 rounded border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white resize-none"
                        style={{ fontFamily: "'Libre Franklin', sans-serif", minHeight: 180 }}
                      />
                    </div>
                  </div>
                )}

                {/* Preview tab — rendered iframe */}
                {emailTab === "preview" && (
                  <div className="flex-1 flex flex-col min-h-0">
                    <iframe
                      srcDoc={liveHtmlEmail}
                      className="w-full rounded border border-slate-200 bg-white flex-1"
                      style={{ minHeight: 320 }}
                      title="Email Preview"
                      sandbox="allow-same-origin"
                    />
                  </div>
                )}

              </div>

              {/* Footer */}
              <style>{`
                @keyframes gbfFadeOut {
                  0%   { opacity: 1; }
                  60%  { opacity: 1; }
                  100% { opacity: 0; }
                }
                .gbf-copy-notif { animation: gbfFadeOut 3.5s forwards; }
              `}</style>
              <div className="shrink-0 px-4 sm:px-6 py-3 border-t border-slate-200 bg-slate-50">
                {copiedHtml && (
                  <p className="gbf-copy-notif text-center text-sm font-semibold text-green-700 mb-2">
                    Email Copied — Paste (Ctrl+V) into a new email message.
                  </p>
                )}
                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => handleCopyHtml(liveHtmlEmail)}
                    className="px-5 py-2 rounded text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm"
                    style={{ backgroundColor: NAVY }}
                  >
                    Copy Email
                  </button>
                  <button
                    type="button"
                    onClick={() => { reset(); onOpenChange(false); }}
                    className="px-5 py-2 rounded text-sm font-semibold border border-slate-300 text-slate-600 hover:bg-slate-100 transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ── Form (hidden when showing email preview) ───── */}
          {!emailPreview && (<><div className="overflow-y-auto flex-1 px-6 py-5 space-y-5" style={{ fontFamily: "'Libre Franklin', sans-serif" }}>

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
