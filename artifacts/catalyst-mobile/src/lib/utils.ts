import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const PROFICIENCY_THRESHOLD = 0.7;

export function getProficiencyLabel(avg: number): "Proficient" | "Not Proficient" {
  return avg >= PROFICIENCY_THRESHOLD ? "Proficient" : "Not Proficient";
}
