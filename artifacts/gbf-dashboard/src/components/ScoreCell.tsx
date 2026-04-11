import type { CSSProperties } from "react";

interface ScoreCellProps {
  score: number | null;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
}

/* Round to 1 decimal so displayed value and color always agree */
function r1(score: number): number {
  return Math.round(score * 10) / 10;
}

/* Used by sub-avg and other summary cells that keep a colored background */
export function getScoreColor(score: number): string {
  const s = r1(score);
  if (s >= 0.7) return "bg-green-600 text-white";
  if (s >= 0.5) return "bg-yellow-300 text-yellow-900";
  return "bg-red-300 text-red-900";
}

export function getScoreColorExact(score: number): string {
  const s = r1(score);
  if (s >= 1)   return "bg-green-600 text-white";
  if (s >= 0.5) return "bg-yellow-300 text-yellow-900";
  return "bg-red-300 text-red-900";
}

/* Returns a hex color for text-only coloring (white-background domain cells) */
export function getScoreTextColor(score: number): string {
  const s = r1(score);
  if (s >= 0.7) return "#16a34a"; // green-600
  if (s >= 0.5) return "#d97706"; // amber-600
  return "#dc2626";               // red-600
}

export function ScoreCell({ score, className = "", style, onClick }: ScoreCellProps) {
  const clickable = !!onClick;

  if (score === null) {
    return (
      <td
        className={`text-center text-slate-300 ${className} ${clickable ? "cursor-pointer" : ""}`}
        style={{ width: 60, minWidth: 60, backgroundColor: "white", fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, ...style }}
        onClick={onClick}
        title={clickable ? "Click to view score history" : undefined}
      >
        —
      </td>
    );
  }

  const textColor = getScoreTextColor(score);
  const display = score.toFixed(1);

  return (
    <td
      className={`text-center font-bold ${className} ${
        clickable
          ? "cursor-pointer relative transition-all duration-100 hover:bg-slate-50"
          : ""
      }`}
      style={{ width: 60, minWidth: 60, backgroundColor: "white", color: textColor, fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, ...style }}
      onClick={onClick}
      title={clickable ? "Click to view score history" : undefined}
    >
      {display}
    </td>
  );
}
