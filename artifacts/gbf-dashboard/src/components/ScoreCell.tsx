import type { CSSProperties } from "react";

interface ScoreCellProps {
  score: number;
  className?: string;
  style?: CSSProperties;
}

export function getScoreColor(score: number): string {
  if (score >= 3.75) return "bg-green-700 text-white";
  if (score >= 3.25) return "bg-green-600 text-white";
  if (score >= 2.75) return "bg-green-200 text-green-900";
  if (score >= 2.25) return "bg-green-100 text-green-900";
  if (score >= 1.75) return "bg-yellow-100 text-yellow-900";
  if (score >= 1.25) return "bg-red-100 text-red-900";
  return "bg-red-200 text-red-900";
}

export function getScoreColorExact(score: 1 | 2 | 3 | 4): string {
  switch (score) {
    case 4: return "bg-green-700 text-white";
    case 3: return "bg-green-200 text-green-900";
    case 2: return "bg-yellow-100 text-yellow-900";
    case 1: return "bg-red-100 text-red-900";
  }
}

export function ScoreCell({ score, className = "", style }: ScoreCellProps) {
  const isExact = Number.isInteger(score);
  const colorClass = isExact
    ? getScoreColorExact(score as 1 | 2 | 3 | 4)
    : getScoreColor(score);

  return (
    <td
      className={`text-center font-semibold ${colorClass} ${className}`}
      style={{ width: 68, minWidth: 68, ...style }}
    >
      {score.toFixed(isExact ? 0 : 1)}
    </td>
  );
}
