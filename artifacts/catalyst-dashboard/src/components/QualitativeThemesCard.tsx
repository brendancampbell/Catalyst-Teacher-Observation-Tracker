import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles, RefreshCw, CheckCircle2, Clock, AlertCircle, ChevronDown, ChevronRight, Users, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  fetchQualitativeThemes,
  generateQualitativeThemes,
  type QualitativeTheme,
  type QualitativeThemesResult,
} from "@/lib/api";

const NAVY   = "#1034B4";
const YELLOW = "#FFB500";

interface Props {
  schoolId:   number | null;
  rubricSlug: string;
  basePath:   string;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month:  "short",
    day:    "numeric",
    year:   "numeric",
    hour:   "numeric",
    minute: "2-digit",
  });
}

function ThemeRow({
  theme,
  accent,
  basePath,
  schoolId,
  rubricSlug,
}: {
  theme:      QualitativeTheme;
  accent:     "green" | "orange";
  basePath:   string;
  schoolId:   number | null;
  rubricSlug: string;
}) {
  const [open, setOpen] = useState(false);
  const color = accent === "green" ? "#15803d" : "#c2410c";
  const bg    = accent === "green" ? "#f0fdf4" : "#fff7ed";

  const dashboardHref = schoolId != null
    ? `${basePath}?school=${schoolId}&rubric=${encodeURIComponent(rubricSlug)}`
    : `${basePath}?rubric=${encodeURIComponent(rubricSlug)}`;

  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{ borderColor: accent === "green" ? "#bbf7d0" : "#fed7aa" }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:opacity-90"
        style={{ backgroundColor: bg }}
      >
        <span className="mt-0.5 shrink-0">
          {open ? <ChevronDown size={15} style={{ color }} /> : <ChevronRight size={15} style={{ color }} />}
        </span>
        <span className="flex-1 text-sm font-semibold leading-snug" style={{ color }}>
          {theme.theme}
        </span>
        <span
          className="shrink-0 flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ml-2"
          style={{ backgroundColor: "white", color, border: `1px solid ${accent === "green" ? "#86efac" : "#fdba74"}` }}
        >
          <Users size={11} />
          {theme.teacherCount} teacher{theme.teacherCount !== 1 ? "s" : ""}
        </span>
      </button>

      {open && (
        <div className="px-4 py-3 border-t text-xs space-y-2" style={{ borderColor: accent === "green" ? "#bbf7d0" : "#fed7aa", backgroundColor: "white" }}>
          <p className="text-slate-500">
            Appears in <strong>{theme.observationCount}</strong> observation{theme.observationCount !== 1 ? "s" : ""} across{" "}
            <strong>{theme.teacherCount}</strong> teacher{theme.teacherCount !== 1 ? "s" : ""}.
          </p>
          <p className="text-slate-400">Teacher IDs: {theme.teacherIds.join(", ")}</p>
          <a
            href={dashboardHref}
            className="inline-flex items-center gap-1 font-semibold transition-colors hover:underline"
            style={{ color: NAVY }}
          >
            <ExternalLink size={11} />
            View teachers in dashboard
          </a>
        </div>
      )}
    </div>
  );
}

export function QualitativeThemesCard({ schoolId, rubricSlug, basePath }: Props) {
  const queryClient = useQueryClient();

  const { data: cacheData, isLoading: cacheLoading } = useQuery({
    queryKey: ["qualitative-themes", schoolId, rubricSlug],
    queryFn:  () => fetchQualitativeThemes(schoolId!, rubricSlug),
    enabled:  schoolId != null && !!rubricSlug,
    staleTime: 5 * 60_000,
  });

  const { mutate: generate, isPending: generating, error: generateError } = useMutation({
    mutationFn: () => generateQualitativeThemes(schoolId!, rubricSlug),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qualitative-themes", schoolId, rubricSlug] });
    },
  });

  const cached          = cacheData?.cache;
  const result: QualitativeThemesResult | null = cached?.result ?? null;
  const currentObsCount = cacheData?.currentObsCount ?? 0;
  const hasNewObs       = cached != null && currentObsCount > cached.obsCountAtGeneration;
  const schoolName      = result?.schoolName ?? "School";

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="px-5 pt-5 pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base font-bold" style={{ color: NAVY }}>
              <Sparkles size={17} style={{ color: YELLOW }} />
              Qualitative Themes
            </CardTitle>
            <p className="text-xs text-slate-500 mt-0.5 font-medium">
              {schoolName} · {rubricSlug}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {hasNewObs && (
              <Badge
                className="text-xs font-bold px-2 py-0.5"
                style={{ backgroundColor: "#FEF9C3", color: "#92400E", border: "1px solid #FDE68A" }}
              >
                {currentObsCount - cached!.obsCountAtGeneration} new obs since last run
              </Badge>
            )}

            <Button
              size="sm"
              onClick={() => generate()}
              disabled={generating || cacheLoading || schoolId == null}
              className="flex items-center gap-1.5 font-bold text-xs px-3 h-8"
              style={{
                backgroundColor: YELLOW,
                color:           NAVY,
                fontFamily:      "'Bebas Neue', sans-serif",
                fontSize:        14,
                letterSpacing:   "0.04em",
              }}
            >
              {generating ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : (
                <Sparkles size={13} />
              )}
              {result ? "Regenerate" : "Generate Summary"}
            </Button>
          </div>
        </div>

        {cached && (
          <p className="text-xs text-slate-400 mt-1">
            Last updated {formatDateTime(cached.generatedAt)}
            {" · "}based on {cached.obsCountAtGeneration} observation{cached.obsCountAtGeneration !== 1 ? "s" : ""}
          </p>
        )}
      </CardHeader>

      <CardContent className="px-5 pb-5">
        {/* Loading / error / empty states */}
        {cacheLoading && (
          <div className="flex items-center justify-center py-10">
            <RefreshCw size={20} className="animate-spin text-slate-300" />
          </div>
        )}

        {!cacheLoading && generating && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <RefreshCw size={22} className="animate-spin" style={{ color: NAVY }} />
            <p className="text-sm font-semibold" style={{ color: NAVY }}>Analyzing observations…</p>
            <p className="text-xs text-slate-400">Claude is reading all glows, grows, and action steps for this school and period. This usually takes 15–30 seconds.</p>
          </div>
        )}

        {!cacheLoading && !generating && generateError && (
          <div className="flex items-center gap-2 py-4 px-3 rounded-lg bg-red-50 text-red-700 text-sm">
            <AlertCircle size={15} />
            <span>{(generateError as Error).message}</span>
          </div>
        )}

        {!cacheLoading && !generating && !result && !generateError && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Sparkles size={24} className="text-slate-300" />
            <p className="text-sm font-semibold text-slate-500">No summary yet</p>
            <p className="text-xs text-slate-400 max-w-xs">
              Click <strong>Generate Summary</strong> to analyze all observation glows, grows, and action steps for this school and period.
            </p>
          </div>
        )}

        {/* Main content — three sections */}
        {result && !generating && (
          <div className="space-y-6">

            {/* ── Recurring Glows ── */}
            <section>
              <h3 className="flex items-center gap-2 text-sm font-bold mb-3" style={{ color: "#15803d" }}>
                <span>✦</span> Recurring Glows
                <span className="text-xs font-normal text-slate-400">
                  — themes appearing across multiple teachers
                </span>
              </h3>
              {result.recurringGlows.length === 0 ? (
                <p className="text-xs text-slate-400 italic">No recurring glows identified across multiple teachers yet.</p>
              ) : (
                <div className="space-y-2">
                  {result.recurringGlows.map((theme, i) => (
                    <ThemeRow key={i} theme={theme} accent="green" basePath={basePath} schoolId={schoolId} rubricSlug={rubricSlug} />
                  ))}
                </div>
              )}
            </section>

            {/* ── Recurring Grows ── */}
            <section>
              <h3 className="flex items-center gap-2 text-sm font-bold mb-3" style={{ color: "#c2410c" }}>
                <span>↑</span> Recurring Grows
                <span className="text-xs font-normal text-slate-400">
                  — themes appearing across multiple teachers
                </span>
              </h3>
              {result.recurringGrows.length === 0 ? (
                <p className="text-xs text-slate-400 italic">No recurring grows identified across multiple teachers yet.</p>
              ) : (
                <div className="space-y-2">
                  {result.recurringGrows.map((theme, i) => (
                    <ThemeRow key={i} theme={theme} accent="orange" basePath={basePath} schoolId={schoolId} rubricSlug={rubricSlug} />
                  ))}
                </div>
              )}
            </section>

            {/* ── Action Step Follow-Through ── */}
            <section>
              <h3 className="flex items-center gap-2 text-sm font-bold mb-3" style={{ color: NAVY }}>
                <CheckCircle2 size={14} /> Action Step Follow-Through
              </h3>

              {/* Counts row */}
              <div className="grid grid-cols-3 gap-3 mb-3">
                {[
                  { label: "Open",    value: result.actionStepFollowThrough.open,     color: "#1d4ed8", bg: "#eff6ff", border: "#bfdbfe" },
                  { label: "Overdue", value: result.actionStepFollowThrough.overdue,  color: "#b91c1c", bg: "#fef2f2", border: "#fecaca" },
                  { label: "Resolved",value: result.actionStepFollowThrough.resolved, color: "#15803d", bg: "#f0fdf4", border: "#bbf7d0" },
                ].map(({ label, value, color, bg, border }) => (
                  <div
                    key={label}
                    className="rounded-lg px-3 py-2.5 text-center"
                    style={{ backgroundColor: bg, border: `1px solid ${border}` }}
                  >
                    <p className="text-xl font-bold tabular-nums" style={{ color, fontFamily: "'Bebas Neue', sans-serif" }}>{value}</p>
                    <p className="text-xs font-semibold mt-0.5" style={{ color }}>{label}</p>
                  </div>
                ))}
              </div>

              {/* Grows with no action step */}
              {result.actionStepFollowThrough.growsWithNoActionStep.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <p className="text-xs font-bold text-amber-800 mb-1.5 flex items-center gap-1.5">
                    <Clock size={12} /> Grow themes with no action step assigned
                  </p>
                  <ul className="space-y-1">
                    {result.actionStepFollowThrough.growsWithNoActionStep.map((theme, i) => (
                      <li key={i} className="text-xs text-amber-700 flex items-start gap-1.5">
                        <span className="mt-0.5 shrink-0">·</span>
                        {theme}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.actionStepFollowThrough.growsWithNoActionStep.length === 0 && result.recurringGrows.length > 0 && (
                <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700 font-semibold flex items-center gap-2">
                  <CheckCircle2 size={13} />
                  All recurring grow themes have at least one action step assigned.
                </div>
              )}
            </section>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
