import { Router } from "express";
import { db } from "@workspace/db";
import {
  observations,
  observationScores,
  people,
  rubricCategories,
  rubricDomains,
} from "@workspace/db/schema";
import { eq, desc, inArray } from "drizzle-orm";
import { getUncachableResendClient } from "../lib/resend";

const router = Router();

/* ── Helpers ─────────────────────────────────────────────── */

function richToEmailHtml(text: string, color: string): string {
  if (!text?.trim()) return `<p style="margin:0;font-size:13px;color:${color};font-style:italic;">(none entered)</p>`;
  const isHtml = /<[a-z][\s\S]*>/i.test(text);
  if (isHtml) return `<div style="font-size:13px;color:${color};line-height:1.6;">${text}</div>`;
  return `<p style="margin:0;font-size:13px;color:${color};line-height:1.6;white-space:pre-wrap;">${text.trim()}</p>`;
}

function formatDateLong(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function scoreBg(val: number | undefined): string {
  if (val === undefined) return "#e2e8f0";
  if (val >= 1) return "#16a34a";
  if (val >= 0.5) return "#ca8a04";
  return "#dc2626";
}

function scoreColor(val: number | undefined): string {
  if (val === undefined) return "#94a3b8";
  return "#ffffff";
}

function scoreText(val: number | undefined): string {
  if (val === undefined) return "—";
  return val === 0.5 ? "0.5" : String(val);
}

function trendHtml(
  domainSlug: string,
  currentVal: number | undefined,
  prevScores: Record<string, number>
): string {
  if (currentVal === undefined)
    return `<span style="color:#cbd5e1;font-size:14px;">—</span>`;
  const prevVal = prevScores[domainSlug];
  if (prevVal === undefined)
    return `<span style="color:#94a3b8;font-size:13px;" title="First observation">New</span>`;
  if (currentVal > prevVal)
    return `<span style="color:#16a34a;font-size:18px;font-weight:900;line-height:1;">↑</span>`;
  if (currentVal < prevVal)
    return `<span style="color:#dc2626;font-size:18px;font-weight:900;line-height:1;">↓</span>`;
  return `<span style="color:#94a3b8;font-size:18px;font-weight:700;line-height:1;">→</span>`;
}

function buildHtmlEmail(params: {
  intro: string;
  glowsText: string;
  growsText: string;
  teacherName: string;
  teacherSubject: string | null;
  teacherGrade: string | null;
  date: string;
  time: string | null;
  course: string | null;
  observer: string;
  scoreMap: Record<string, number>;
  prevScoreMap: Record<string, number>;
  categories: Array<{ label: string; domains: Array<{ slug: string; label: string }> }>;
  logoUrl: string;
}): string {
  const {
    intro, glowsText, growsText, teacherName, teacherSubject,
    teacherGrade, date, time, course, observer,
    scoreMap, prevScoreMap, categories, logoUrl,
  } = params;

  const dateLabel = formatDateLong(date);

  const scoredVals = Object.values(scoreMap);
  const overallAvg =
    scoredVals.length
      ? (scoredVals.reduce((a, b) => a + b, 0) / scoredVals.length).toFixed(2)
      : null;

  let scoreTableRows = "";
  for (const cat of categories) {
    scoreTableRows += `
      <tr>
        <td colspan="3" style="background:#1034B4;color:#fff;font-family:'Bebas Neue',Arial,sans-serif;font-size:15px;letter-spacing:0.06em;padding:8px 14px;text-transform:uppercase;">${cat.label}</td>
      </tr>`;
    let catTotal = 0, catCount = 0;
    for (const domain of cat.domains) {
      const val = scoreMap[domain.slug];
      scoreTableRows += `
      <tr style="border-bottom:1px solid #e2e8f0;">
        <td style="padding:8px 14px;font-size:13px;color:#374151;">${domain.label}</td>
        <td style="padding:8px 6px;text-align:center;">
          <span style="display:inline-block;background:${scoreBg(val)};color:${scoreColor(val)};border-radius:4px;padding:2px 10px;font-size:12px;font-weight:700;min-width:32px;">${scoreText(val)}</span>
        </td>
        <td style="padding:8px 10px;text-align:center;">${trendHtml(domain.slug, val, prevScoreMap)}</td>
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

  if (overallAvg !== null) {
    scoreTableRows += `
      <tr style="background:#1034B4;">
        <td style="padding:9px 14px;font-size:13px;font-weight:700;color:#fff;">Overall Average</td>
        <td style="padding:9px 6px;text-align:center;font-size:14px;font-weight:700;color:#FFB500;">${overallAvg}</td>
        <td></td>
      </tr>`;
  }

  const gradeLabel = teacherGrade ? `Grade ${teacherGrade}` : "";

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
                <img src="${logoUrl}" alt="Uncommon Schools" height="36" style="display:block;height:36px;max-width:180px;filter:brightness(0) invert(1);"/>
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
            ${time ? `<tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:8px 14px;font-size:12px;font-weight:700;color:#64748b;background:#f8fafc;">Time</td>
              <td style="padding:8px 14px;font-size:13px;color:#1e293b;">${time}</td>
            </tr>` : ""}
            <tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:8px 14px;font-size:12px;font-weight:700;color:#64748b;background:#f8fafc;">Observer</td>
              <td style="padding:8px 14px;font-size:13px;color:#1e293b;">${observer}</td>
            </tr>
            <tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:8px 14px;font-size:12px;font-weight:700;color:#64748b;background:#f8fafc;">Teacher</td>
              <td style="padding:8px 14px;font-size:13px;color:#1e293b;">${teacherName}</td>
            </tr>
            ${teacherSubject ? `<tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:8px 14px;font-size:12px;font-weight:700;color:#64748b;background:#f8fafc;">Subject</td>
              <td style="padding:8px 14px;font-size:13px;color:#1e293b;">${teacherSubject}</td>
            </tr>` : ""}
            ${gradeLabel ? `<tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:8px 14px;font-size:12px;font-weight:700;color:#64748b;background:#f8fafc;">Grade</td>
              <td style="padding:8px 14px;font-size:13px;color:#1e293b;">${gradeLabel}</td>
            </tr>` : ""}
            ${course ? `<tr>
              <td style="padding:8px 14px;font-size:12px;font-weight:700;color:#64748b;background:#f8fafc;">Course</td>
              <td style="padding:8px 14px;font-size:13px;color:#1e293b;">${course}</td>
            </tr>` : ""}
          </table>
        </td>
      </tr>

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
      </tr>

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

      <!-- Spacer -->
      <tr><td style="height:24px;font-size:0;line-height:0;">&nbsp;</td></tr>

      <!-- Footer -->
      <tr>
        <td style="padding:24px 28px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:11px;color:#94a3b8;text-align:center;">&copy; ${new Date().getFullYear()} Uncommon Schools, Inc. All rights reserved.</p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

/* ── POST /api/email/send-observation ───────────────────────
   Body: { observationId, intro, glows, grows, subject,
           teacherEmail?, logoUrl? }
   Sends the branded HTML email to the teacher via Resend.   */
router.post("/send-observation", async (req, res) => {
  try {
    const {
      observationId,
      intro,
      glows,
      grows,
      subject,
      teacherEmail,
      logoUrl,
    } = req.body;

    if (!observationId || !intro || !subject) {
      res.status(400).json({ error: "observationId, intro and subject are required" });
      return;
    }

    if (!teacherEmail) {
      res.status(400).json({ error: "Teacher has no email address on record" });
      return;
    }

    /* ── Load observation + scores ─────────────────────────── */
    const obs = await db.query.observations.findFirst({
      where: eq(observations.id, Number(observationId)),
    });
    if (!obs) { res.status(404).json({ error: "Observation not found" }); return; }

    const teacher = obs.observedEmployeeId
      ? await db.query.people.findFirst({ where: eq(people.employeeId, obs.observedEmployeeId) })
      : null;
    if (!teacher) { res.status(404).json({ error: "Teacher not found" }); return; }

    const scoreRows = await db
      .select()
      .from(observationScores)
      .where(eq(observationScores.observationId, Number(observationId)));

    const scoreMap: Record<string, number> = Object.fromEntries(
      scoreRows.map((r) => [r.domainSlug, r.score])
    );

    /* ── Load prior observation for trend arrows ───────────── */
    const priorObs = obs.observedEmployeeId ? await db
      .select()
      .from(observations)
      .where(eq(observations.observedEmployeeId, obs.observedEmployeeId))
      .orderBy(desc(observations.date))
      .limit(10) : [];

    let prevScoreMap: Record<string, number> = {};
    for (const prior of priorObs) {
      if (prior.id === Number(observationId)) continue;
      const priorScores = await db
        .select()
        .from(observationScores)
        .where(eq(observationScores.observationId, prior.id));
      prevScoreMap = Object.fromEntries(priorScores.map((r) => [r.domainSlug, r.score]));
      break;
    }

    /* ── Load rubric categories + domains ──────────────────── */
    const cats = await db
      .select()
      .from(rubricCategories)
      .where(eq(rubricCategories.rubricSetId, obs.rubricSetId))
      .orderBy(rubricCategories.displayOrder);

    const catIds = cats.map((c) => c.id);
    const domains = catIds.length
      ? await db
          .select()
          .from(rubricDomains)
          .where(inArray(rubricDomains.categoryId, catIds))
          .orderBy(rubricDomains.displayOrder)
      : [];

    const categories = cats.map((cat) => ({
      label: cat.name,
      domains: domains
        .filter((d) => d.categoryId === cat.id)
        .map((d) => ({ slug: d.slug, label: d.name })),
    }));

    /* ── Build HTML ────────────────────────────────────────── */
    const html = buildHtmlEmail({
      intro,
      glowsText: glows ?? "",
      growsText: grows ?? "",
      teacherName: `${teacher.firstName} ${teacher.lastName}`.trim(),
      teacherSubject: teacher.department ?? null,
      teacherGrade: Array.isArray(teacher.gradeLevel) ? teacher.gradeLevel.join(", ") : (teacher.gradeLevel ?? null),
      date: obs.date,
      time: obs.time,
      course: obs.course,
      observer: obs.observer,
      scoreMap,
      prevScoreMap,
      categories,
      logoUrl: logoUrl ?? "https://www.uncommonschools.org/favicon.ico",
    });

    /* ── Send via Resend ───────────────────────────────────── */
    const { client, fromEmail } = await getUncachableResendClient();

    const { error: resendError } = await client.emails.send({
      from: fromEmail || "Uncommon Schools Catalyst <onboarding@resend.dev>",
      to: [teacherEmail],
      subject,
      html,
    });

    if (resendError) {
      console.error("Resend error:", resendError);
      res.status(502).json({ error: resendError.message });
      return;
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /email/send-observation error:", err);
    res.status(500).json({ error: String(err) });
  }
});

export default router;
