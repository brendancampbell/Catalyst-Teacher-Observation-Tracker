import type { CSSProperties } from "react";

interface ScoreCellProps {
  score: number | null;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
}

export function getScoreColor(score: number): string {
  if (score >= 0.7) return "bg-green-600 text-white";
  if (score >= 0.5) return "bg-yellow-300 text-yellow-900";
  return "bg-red-300 text-red-900";
}

export function getScoreColorExact(score: number): string {
  if (score >= 1)   return "bg-green-600 text-white";
  if (score >= 0.5) return "bg-yellow-300 text-yellow-900";
  return "bg-red-300 text-red-900";
}

export function ScoreCell({ score, className = "", style, onClick }: ScoreCellProps) {
  const clickable = !!onClick;

  if (score === null) {
    return (
      <td
        className={`text-center text-slate-300 ${className} ${clickable ? "cursor-pointer" : ""}`}
        style={{ width: 60, minWidth: 60, ...style }}
        onClick={onClick}
        title={clickable ? "Click to view score history" : undefined}
      >
        —
      </td>
    );
  }

  const colorClass = getScoreColor(score);
  const display = score.toFixed(1);

  return (
    <td
      className={`text-center text-base font-bold ${colorClass} ${className} ${
        clickable
          ? "cursor-pointer relative transition-all duration-100 hover:ring-2 hover:ring-inset hover:ring-white/60 hover:brightness-90"
          : ""
      }`}
      style={{ width: 60, minWidth: 60, ...style }}
      onClick={onClick}
      title={clickable ? "Click to view score history" : undefined}
    >
      {display}
    </td>
  );
}
