import type {
  User,
  School,
  RubricSet,
  RubricDomain,
  RubricCategory,
  TeacherRow,
  Score,
} from "@workspace/api-types";

export type {
  User,
  School,
  RubricSet,
  RubricDomain,
  RubricCategory,
  Score,
};

export type { TeacherRow };

/** Backward-compatible alias: mobile callers import `Teacher` from this module. */
export type Teacher = TeacherRow;

const BASE = "";

export async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...opts?.headers },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}
