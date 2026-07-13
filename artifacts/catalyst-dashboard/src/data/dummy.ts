export type { Score, Observation, Teacher } from "@workspace/api-types";

export type DomainEntry = { readonly id: string; readonly label: string };

export const SUBJECTS = ["English", "Math", "Science", "History", "PE", "Art", "Music", "Special Ed"] as const;
export const GRADE_LEVELS = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"] as const;
