import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/lib/queryKeys";
import { fetchSystemSettings, previewSystemSettings, updateSystemSettings } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import {
  RESCORE_WINDOW_WEEK_OPTIONS, DAYS_PER_WEEK,
  OVERDUE_WINDOW_MIN_DAYS, OVERDUE_WINDOW_MAX_DAYS,
  daysToWholeWeeks,
} from "@workspace/api-types";

function formatChangedAt(at: string | null, by: string | null): string | null {
  if (!at) return null;
  const when = new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return by ? `Last changed by ${by} on ${when}` : `Last changed on ${when}`;
}

/**
 * The two network-wide deadlines.
 *
 * Both were hardcoded at 14 days. They are separate settings on purpose: one
 * is how fast a struggling teacher must be seen again, the other is how often
 * everybody should be seen, and moving one should not move the other.
 *
 * Neither saves without saying what it will do. Shortening the rescore window
 * moves deadlines that coaches may already have given teachers, and can put
 * somebody past due the moment it is saved; shortening the overdue window puts
 * people on a list they were not on that morning. Both counts are measured by
 * the server rather than guessed at here.
 */
export function RescoreWindowSettings() {
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: QUERY_KEYS.systemSettings,
    queryFn:  fetchSystemSettings,
  });

  const [rescoreWeeks, setRescoreWeeks] = useState<number | null>(null);
  const [overdueDays,  setOverdueDays]  = useState<string>("");
  const [saving, setSaving] = useState<null | "rescore" | "overdue">(null);

  /* Track the server's values until the person changes something. */
  useEffect(() => {
    if (!settings) return;
    setRescoreWeeks(daysToWholeWeeks(settings.rescoreWindowDays));
    setOverdueDays(String(settings.overdueWindowDays));
  }, [settings]);

  async function saveRescore(weeks: number) {
    if (!settings) return;
    const days = weeks * DAYS_PER_WEEK;
    if (days === settings.rescoreWindowDays) return;

    setSaving("rescore");
    try {
      const preview = await previewSystemSettings({ rescoreWindowDays: days });

      /* Every queued teacher's deadline moves. Say so, and say plainly when
         some of them land in the past. */
      const lines = [
        `Change the rescore window to ${weeks} week${weeks === 1 ? "" : "s"}?`,
        "",
        preview.rescoreAffected === 0
          ? "No teachers are currently in the rescore queue."
          : `${preview.rescoreAffected} teacher${preview.rescoreAffected === 1 ? "" : "s"} in the rescore queue will have their deadline recalculated from the date of their walkthrough.`,
      ];
      if (preview.rescoreNewlyOverdue > 0) {
        lines.push("");
        lines.push(
          `${preview.rescoreNewlyOverdue} of them will become OVERDUE immediately, because their new deadline has already passed.`,
        );
      }
      lines.push("");
      lines.push("Continue?");

      if (!window.confirm(lines.join("\n"))) {
        setRescoreWeeks(daysToWholeWeeks(settings.rescoreWindowDays));
        return;
      }

      const saved = await updateSystemSettings({ rescoreWindowDays: days });
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.systemSettings });
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.rescoreQueue });
      toast({
        title: `Rescore window set to ${weeks} week${weeks === 1 ? "" : "s"}`,
        description: saved.recalculated > 0
          ? `${saved.recalculated} deadline${saved.recalculated === 1 ? "" : "s"} recalculated.`
          : undefined,
      });
    } catch (err) {
      toast({ title: "Could not change the rescore window", description: (err as Error).message, variant: "destructive" });
      setRescoreWeeks(daysToWholeWeeks(settings.rescoreWindowDays));
    } finally {
      setSaving(null);
    }
  }

  async function saveOverdue() {
    if (!settings) return;
    const days = Number(overdueDays);

    if (!Number.isInteger(days) || days < OVERDUE_WINDOW_MIN_DAYS || days > OVERDUE_WINDOW_MAX_DAYS) {
      toast({
        title: `Enter a whole number of days between ${OVERDUE_WINDOW_MIN_DAYS} and ${OVERDUE_WINDOW_MAX_DAYS}`,
        variant: "destructive",
      });
      setOverdueDays(String(settings.overdueWindowDays));
      return;
    }
    if (days === settings.overdueWindowDays) return;

    setSaving("overdue");
    try {
      const preview = await previewSystemSettings({ overdueWindowDays: days });

      const lines = [`Change the overdue window to ${days} day${days === 1 ? "" : "s"}?`, ""];
      if (preview.overdueNewlyListed > 0) {
        lines.push(
          `${preview.overdueNewlyListed} teacher${preview.overdueNewlyListed === 1 ? "" : "s"} will appear in Overdue Observations who are not there now.`,
        );
      } else {
        lines.push("No teachers will newly appear in Overdue Observations.");
      }
      lines.push("");
      lines.push("Continue?");

      if (!window.confirm(lines.join("\n"))) {
        setOverdueDays(String(settings.overdueWindowDays));
        return;
      }

      await updateSystemSettings({ overdueWindowDays: days });
      await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.systemSettings });
      toast({ title: `Overdue window set to ${days} day${days === 1 ? "" : "s"}` });
    } catch (err) {
      toast({ title: "Could not change the overdue window", description: (err as Error).message, variant: "destructive" });
      setOverdueDays(String(settings.overdueWindowDays));
    } finally {
      setSaving(null);
    }
  }

  if (isLoading || !settings) {
    return <p className="text-sm text-slate-400">Loading settings…</p>;
  }

  const rescoreChanged = formatChangedAt(settings.rescoreUpdatedAt, settings.rescoreUpdatedBy);
  const overdueChanged = formatChangedAt(settings.overdueUpdatedAt, settings.overdueUpdatedBy);

  const inputBase =
    "px-3 py-2 rounded border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white";

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {/* ── Rescore window ─────────────────────────────── */}
      <div>
        <label className="block text-sm font-bold text-slate-700 mb-1">Rescore window</label>
        <p className="text-xs text-slate-500 mb-2 leading-relaxed">
          How long a teacher has to be rescored after a walkthrough below the proficiency
          threshold. Changing this recalculates every teacher already in the rescore queue,
          measured from the date of their walkthrough.
        </p>
        <select
          className={`${inputBase} w-48`}
          value={rescoreWeeks ?? ""}
          disabled={saving !== null}
          onChange={(e) => {
            const weeks = Number(e.target.value);
            setRescoreWeeks(weeks);
            void saveRescore(weeks);
          }}
        >
          {/* A hand-edited database could hold a window that is not a whole
              number of weeks; show it rather than silently rounding. */}
          {rescoreWeeks === null && (
            <option value="">{settings.rescoreWindowDays} days (not a whole number of weeks)</option>
          )}
          {RESCORE_WINDOW_WEEK_OPTIONS.map((w) => (
            <option key={w} value={w}>{w} week{w === 1 ? "" : "s"}</option>
          ))}
        </select>
        {rescoreChanged && <p className="text-xs text-slate-400 mt-1.5">{rescoreChanged}</p>}
      </div>

      {/* ── Overdue window ─────────────────────────────── */}
      <div>
        <label className="block text-sm font-bold text-slate-700 mb-1">Overdue observation window</label>
        <p className="text-xs text-slate-500 mb-2 leading-relaxed">
          How long since a teacher's last observation before they appear in Overdue
          Observations. This list is worked out fresh each time it is opened, so changing
          this moves no deadlines — it changes who is listed.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            className={`${inputBase} w-24`}
            min={OVERDUE_WINDOW_MIN_DAYS}
            max={OVERDUE_WINDOW_MAX_DAYS}
            step={1}
            value={overdueDays}
            disabled={saving !== null}
            onChange={(e) => setOverdueDays(e.target.value)}
            onBlur={() => void saveOverdue()}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          />
          <span className="text-sm text-slate-500">days</span>
          <span className="text-xs text-slate-400">
            ({OVERDUE_WINDOW_MIN_DAYS}–{OVERDUE_WINDOW_MAX_DAYS})
          </span>
        </div>
        {overdueChanged && <p className="text-xs text-slate-400 mt-1.5">{overdueChanged}</p>}
      </div>

      <p className="text-xs text-slate-400 leading-relaxed" style={{ borderTop: "1px solid #e2e8f0", paddingTop: 12 }}>
        These apply across the whole network. Both were fixed at 14 days before this setting
        existed, which is why they start there.
      </p>

      <style>{`
        input[type="number"] { -moz-appearance: textfield; }
      `}</style>
    </div>
  );
}
