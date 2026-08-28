import DOMPurify from "dompurify";
import type { Score, CategoryEntry } from "@/lib/api";

/**
 * The feedback email, in one place.
 *
 * Two screens build this now: the observation form, where it is offered the
 * moment an observation is filed, and the observation itself, where it can be
 * sent again later. They must produce the same email — a teacher should not be
 * able to tell which button it came from — so the builders live here rather
 * than in either screen.
 *
 * Nothing is sent from Catalyst. These produce text and HTML for the observer
 * to copy or hand to Outlook, which is why every value is escaped: the HTML is
 * rendered in a preview and pasted into a mail client, both of which will
 * happily execute what they are given. The preview iframe is sandboxed without
 * allow-scripts, but that is a backstop, not a substitute.
 */

const EMAIL_ALLOWED_TAGS = ["p", "br", "strong", "em", "ul", "ol", "li", "b", "i", "u", "s", "blockquote"];

function escapeEmailHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Sanitise TipTap rich text down to a safe formatting-only subset. */
function sanitizeEmailRichText(html: string): string {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS: EMAIL_ALLOWED_TAGS, ALLOWED_ATTR: [] });
}

const SCORE_LABEL: Record<string, string> = { "0": "Not Yet", "0.5": "Developing", "1": "Proficient" };

function formatDateLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function allDomainsOf(categories: CategoryEntry[]) {
  return categories.flatMap((c) => c.domains);
}

export const DEFAULT_INTRO_BODY = `Thank you for your continued commitment to your students. I wanted to share feedback from my recent observation of your classroom. I hope these notes are helpful as you continue to grow in your practice.`;

/** The opening paragraph, before the observer edits it. */
export function defaultIntro(firstName: string, observerName?: string): string {
  return `Dear ${firstName},\n\n${DEFAULT_INTRO_BODY}\n\nWarm regards,\n${observerName ?? "Your Observer"}`;
}

/** How much of the rubric to include. */
export type EmailMode = "all" | "scored" | "glows";

/**
 * The action steps the email mentions.
 *
 * Passed in rather than looked up, because the two callers mean different
 * things by them. The form knows what is about to be assigned or marked
 * mastered. An observation being sent again knows what it actually did at the
 * time — which is what its email should say, even if the step has since been
 * completed or its due date pushed back.
 */
export interface EmailActionSteps {
  /** Marked mastered by this observation. */
  mastered?:  { text: string; masteredByName?: string };
  /** Assigned earlier and still open — the form's case only; an old
      observation cannot say what was open on the day without a
      point-in-time lookup, so it leaves this out rather than guess. */
  stillOpen?: { text: string; dueDate: string; assignedByName?: string };
  /** Assigned by this observation. */
  assigned?:  { text: string; dueDate: string };
}

export interface EmailSource {
  teacher: {
    name:       string;
    firstName?: string;
    email?:     string | null;
    subject?:   string | null;
    gradeLevel: string[];
  } | undefined;
  date:         string;
  /** As shown on the observation. Blank is fine — the row still appears. */
  time?:        string | null;
  course?:      string | null;
  observerName?: string;
  categories:   CategoryEntry[];
  scores:       Record<string, Score | undefined>;
  strengths:    string;
  growthAreas:  string;
  steps:        EmailActionSteps;
  /** Earlier observations of this teacher, for the up/down arrows beside each
      score. Empty is fine — every row then reads "New". */
  priorObservations: { date: string; scores: Record<string, Score | undefined> }[];
}

export function buildEmailPlainText(src: EmailSource, introText: string | undefined, mode: EmailMode): { subject: string; body: string; mailtoUrl: string; outlookWebUrl: string } {
  const teacher = src.teacher;
  const firstName = teacher?.firstName || teacher?.name.split(" ")[0] || "Teacher";
  const dateLabel = formatDateLong(src.date);
  const observer = src.observerName ?? "Your Observer";

  const nl = "\n";
  const divider = "─".repeat(48);

  let scoreBlock = "";
  if (mode !== "glows") {
    for (const cat of src.categories) {
      const domainsToShow = mode === "scored"
        ? cat.domains.filter((d) => src.scores[d.id] !== undefined)
        : cat.domains;
      if (domainsToShow.length === 0) continue;
      scoreBlock += `${nl}${cat.label.toUpperCase()}${nl}`;
      let catTotal = 0, catCount = 0;
      for (const domain of domainsToShow) {
        const raw = src.scores[domain.id];
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

  const scoredVals = allDomainsOf(src.categories).map((d) => src.scores[d.id]).filter((v): v is Score => v !== undefined);
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
    src.strengths.trim() || "(none entered)",
    nl,
    divider,
    `GROWS (Growth Areas)`,
    divider,
    src.growthAreas.trim() || "(none entered)",
  ].join(nl);

  const subject = `Classroom Observation Feedback - ${dateLabel}`;
  const teacherEmail = teacher?.email ?? "";
  const mailtoUrl = `mailto:${encodeURIComponent(teacherEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const outlookWebUrl = `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(teacherEmail)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return { subject, body, mailtoUrl, outlookWebUrl };
}

function richToEmailHtml(text: string, color: string): string {
  if (!text?.trim()) return `<p style="margin:0;font-size:13px;color:${color};font-style:italic;">(none entered)</p>`;
  const isHtml = /<[a-z][\s\S]*>/i.test(text);
  if (isHtml) return `<div style="font-size:13px;color:${color};line-height:1.6;">${sanitizeEmailRichText(text)}</div>`;
  return `<p style="margin:0;font-size:13px;color:${color};line-height:1.6;white-space:pre-wrap;">${escapeEmailHtml(text.trim())}</p>`;
}

export function buildEmailHtml(src: EmailSource, intro: string, glowsText: string, growsText: string, mode: EmailMode): string {
  const teacher = src.teacher;
  const dateLabel = formatDateLong(src.date);
  const observer = src.observerName ?? "Your Observer";
  const logoUrl = `${window.location.origin}/uncommon-logo-white.png`;
  const logoStyle = "display:block;height:36px;max-width:180px;";

  const scoredVals = allDomainsOf(src.categories).map((d) => src.scores[d.id]).filter((v): v is Score => v !== undefined);
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

  /* Trend: compare current scores to the most recent PRIOR observation.
     Only observations dated on or before this one count as prior — sorting
     by date alone would let an observation dated in the future (a mistyped
     year, say) become the baseline and invert the arrow. Drafts are already
     excluded upstream by the dashboard query. */
  const prevObs = src.priorObservations
    .filter((o) => o.date <= src.date)
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
    for (const cat of src.categories) {
      const domainsToShow = mode === "scored"
        ? cat.domains.filter((d) => src.scores[d.id] !== undefined)
        : cat.domains;
      if (domainsToShow.length === 0) continue;
      scoreTableRows += `
      <tr>
        <td colspan="3" style="background:#1034B4;color:#fff;font-family:'Bebas Neue',Arial,sans-serif;font-size:15px;letter-spacing:0.06em;padding:8px 14px;text-transform:uppercase;">${escapeEmailHtml(cat.label)}</td>
      </tr>`;
      let catTotal = 0, catCount = 0;
      for (const domain of domainsToShow) {
        const val = src.scores[domain.id] as Score | undefined;
        const bg = scoreBg(val);
        const fg = scoreColor(val);
        const txt = scoreText(val);
        scoreTableRows += `
      <tr style="border-bottom:1px solid #e2e8f0;">
        <td style="padding:8px 14px;font-size:13px;color:#374151;">${escapeEmailHtml(domain.label)}</td>
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
              <img src="${escapeEmailHtml(logoUrl)}" alt="Uncommon Schools" height="36" style="${logoStyle}"/>
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
        <p style="margin:0;font-size:14px;color:#475569;line-height:1.6;">${escapeEmailHtml(intro).replace(/\n/g, "<br/>")}</p>
      </td>
    </tr>

    <!-- Observation Details -->
    <tr>
      <td style="padding:24px 28px 0 28px;">
        <p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8;">Observation Details</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;">
          <tr style="border-bottom:1px solid #e2e8f0;">
            <td style="padding:8px 14px;font-size:12px;font-weight:700;color:#64748b;width:110px;background:#f8fafc;">Date</td>
            <td style="padding:8px 14px;font-size:13px;color:#1e293b;">${escapeEmailHtml(dateLabel)}</td>
          </tr>
          <tr style="border-bottom:1px solid #e2e8f0;">
            <td style="padding:8px 14px;font-size:12px;font-weight:700;color:#64748b;background:#f8fafc;">Time</td>
            <td style="padding:8px 14px;font-size:13px;color:#1e293b;">${escapeEmailHtml(src.time ?? "")}</td>
          </tr>
          <tr style="border-bottom:1px solid #e2e8f0;">
            <td style="padding:8px 14px;font-size:12px;font-weight:700;color:#64748b;background:#f8fafc;">Observer</td>
            <td style="padding:8px 14px;font-size:13px;color:#1e293b;">${escapeEmailHtml(observer)}</td>
          </tr>
          <tr style="border-bottom:1px solid #e2e8f0;">
            <td style="padding:8px 14px;font-size:12px;font-weight:700;color:#64748b;background:#f8fafc;">Teacher</td>
            <td style="padding:8px 14px;font-size:13px;color:#1e293b;">${escapeEmailHtml(teacher?.name ?? "")}</td>
          </tr>
          <tr style="border-bottom:1px solid #e2e8f0;">
            <td style="padding:8px 14px;font-size:12px;font-weight:700;color:#64748b;background:#f8fafc;">Subject</td>
            <td style="padding:8px 14px;font-size:13px;color:#1e293b;">${escapeEmailHtml(teacher?.subject ?? "")}</td>
          </tr>
          <tr style="border-bottom:1px solid #e2e8f0;">
            <td style="padding:8px 14px;font-size:12px;font-weight:700;color:#64748b;background:#f8fafc;">Grade</td>
            <td style="padding:8px 14px;font-size:13px;color:#1e293b;">${escapeEmailHtml(gradeLabel)}</td>
          </tr>
          ${src.course ? `<tr>
            <td style="padding:8px 14px;font-size:12px;font-weight:700;color:#64748b;background:#f8fafc;">Course</td>
            <td style="padding:8px 14px;font-size:13px;color:#1e293b;">${escapeEmailHtml(src.course)}</td>
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
              ${richToEmailHtml(glowsText, "#166534")}
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
              ${richToEmailHtml(growsText, "#9a3412")}
            </td>
          </tr>
        </table>
      </td>
    </tr>

    ${(() => {
      const { mastered: masteredStep, stillOpen: stillOpenStep, assigned: newStep } = src.steps;
      if (!masteredStep && !stillOpenStep && !newStep) return "";
      let rows = "";
      if (masteredStep) {
        const byLine = masteredStep.masteredByName
          ? ` <span style="color:#6b7280;font-size:12px;">— mastered by ${escapeEmailHtml(masteredStep.masteredByName)}</span>`
          : "";
        rows += `
          <tr style="border-bottom:1px solid #d1fae5;">
            <td style="padding:8px 14px;font-size:12px;font-weight:700;color:#065f46;background:#ecfdf5;width:110px;">✔ Mastered</td>
            <td style="padding:8px 14px;font-size:13px;color:#064e3b;">${richToEmailHtml(masteredStep.text, "#064e3b")}${byLine}</td>
          </tr>`;
      }
      if (stillOpenStep) {
        const assignedLine = stillOpenStep.assignedByName
          ? ` <span style="color:#6b7280;font-size:12px;">— assigned by ${escapeEmailHtml(stillOpenStep.assignedByName)}</span>`
          : "";
        rows += `
          <tr style="border-bottom:1px solid #e2e8f0;">
            <td style="padding:8px 14px;font-size:12px;font-weight:700;color:#b45309;background:#fffbeb;width:110px;">⏳ Still Open</td>
            <td style="padding:8px 14px;font-size:13px;color:#78350f;">${richToEmailHtml(stillOpenStep.text, "#78350f")}<br/><span style="font-size:11px;color:#92400e;">Due: ${escapeEmailHtml(stillOpenStep.dueDate)}</span>${assignedLine}</td>
          </tr>`;
      }
      if (newStep) {
        rows += `
          <tr>
            <td style="padding:8px 14px;font-size:12px;font-weight:700;color:#1d4ed8;background:#eff6ff;width:110px;">🎯 New Step</td>
            <td style="padding:8px 14px;font-size:13px;color:#1e3a8a;">${richToEmailHtml(newStep.text, "#1e3a8a")}<br/><span style="font-size:11px;color:#1e40af;">Due: ${escapeEmailHtml(newStep.dueDate)}</span></td>
          </tr>`;
      }
      return `
    <!-- Action Steps -->
    <tr>
      <td style="padding:16px 28px 0 28px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;">
          <tr>
            <td style="padding:14px 16px 6px 16px;">
              <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#0369a1;">◎ Action Step</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 6px 6px 6px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:4px;overflow:hidden;">
                ${rows}
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
    })()}

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
