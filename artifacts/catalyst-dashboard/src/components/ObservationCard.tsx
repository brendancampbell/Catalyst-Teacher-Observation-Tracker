import { type Score } from "@/data/dummy";
import type { Observation, CategoryEntry } from "@workspace/api-types";
import { getScoreColor, getScoreColorExact } from "@/components/ScoreCell";
import { RichTextDisplay } from "@/components/RichTextDisplay";

const NAVY = "#1034B4";
const YELLOW = "#FFB500";

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });
}

/**
 * One observation in a history, as a card.
 *
 * Shared, because two pages show a history now: a teacher's, and a school's
 * for school-wide observations. They are the same object and should look the
 * same wherever it is listed.
 */
export function ObservationCard({ obs, index, categories, onClick }: { obs: Observation; index: number; categories: CategoryEntry[]; onClick: () => void }) {
  const domains = categories.flatMap((c) => c.domains);
  const scores = domains
    .map((d) => obs.scores[d.id] as Score | undefined)
    .filter((s): s is Score => s !== undefined);
  const avg = scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : null;
  return (
    <div
      className="rounded-xl border overflow-hidden cursor-pointer group transition-shadow hover:shadow-md"
      style={{ borderColor: index === 0 ? YELLOW : "#e2e8f0", boxShadow: index === 0 ? `0 0 0 1.5px ${YELLOW}` : undefined }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(); }}
      aria-label={`View ${obs.isWalkthrough ? "walkthrough" : "observation"} from ${obs.date}`}
    >
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ backgroundColor: index === 0 ? NAVY : "#f8fafc" }}
      >
        <div className="flex items-center gap-2.5">
          {index === 0 && (
            <span
              className="text-xs font-bold uppercase tracking-wider rounded px-2 py-0.5"
              style={{ backgroundColor: YELLOW, color: NAVY }}
            >
              Most Recent
            </span>
          )}
          <span
            className="font-semibold text-sm"
            style={{ color: index === 0 ? "white" : "#374151" }}
          >
            {formatDate(obs.date)}
          </span>
          {/* Walkthroughs are treated differently downstream — below the
              proficiency threshold they put the teacher in the rescore queue —
              so the history should say which observations were one. */}
          {obs.isWalkthrough && (
            <span
              className="text-xs font-bold uppercase tracking-wider rounded px-2 py-0.5"
              style={
                index === 0
                  ? { backgroundColor: "#EEF1FB", color: NAVY }
                  : { backgroundColor: "#EEF1FB", color: NAVY, border: "1px solid #c7d2fe" }
              }
            >
              Walkthrough
            </span>
          )}
          <span
            className="text-xs"
            style={{ color: index === 0 ? "#93c5fd" : "#94a3b8" }}
          >
            by {obs.observer}
          </span>
        </div>
        {avg !== null && (
          <span className={`font-bold text-sm px-3 py-1 rounded ${getScoreColor(avg)}`}>
            {avg.toFixed(1)} avg
          </span>
        )}
      </div>

      <div className="px-4 py-3 space-y-3">
        {categories.map((cat) => (
          <div key={cat.id}>
            <p
              className="text-xs font-bold uppercase tracking-wider mb-1.5"
              style={{ color: NAVY, fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.02em" }}
            >
              {cat.label}
            </p>
            <div className="flex flex-wrap gap-2">
              {cat.domains.map((d) => {
                const s = obs.scores[d.id] as Score | undefined;
                if (s === undefined) return null;
                return (
                  <div key={d.id} className="flex items-center gap-1.5">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${getScoreColorExact(s)}`}>
                      {s}
                    </span>
                    <span className="text-xs text-slate-500">{d.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {(obs.strengths || obs.growthAreas) && (
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: "#16a34a" }}>✦ Glows</p>
              <RichTextDisplay
                content={obs.strengths}
                className="text-slate-600"
                emptyNode={<span className="italic text-slate-400 text-sm">None recorded</span>}
              />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: "#ea580c" }}>↑ Grows</p>
              <RichTextDisplay
                content={obs.growthAreas}
                className="text-slate-600"
                emptyNode={<span className="italic text-slate-400 text-sm">None recorded</span>}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
