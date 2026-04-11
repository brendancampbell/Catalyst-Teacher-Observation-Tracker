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

export interface User {
  id: string;
  name: string;
  email: string;
  role: "COACH" | "SCHOOL_LEADER" | "NETWORK_LEADER" | "NETWORK_ADMIN";
  schoolId: number | null;
  schoolName?: string | null;
}

export interface School {
  id: number;
  name: string;
  region?: string;
  gradeSpan?: string;
}

export interface RubricSet {
  id: number;
  slug: string;
  name: string;
  isArchived?: boolean;
  displayOrder?: number;
}

export interface RubricDomain {
  id: string;
  slug: string;
  name: string;
  description?: string;
  displayOrder: number;
}

export interface RubricCategory {
  id: string;
  name: string;
  displayOrder: number;
  domains: RubricDomain[];
}

export interface Teacher {
  id: number;
  name: string;
  subject: string;
  gradeLevel: string[];
  isActive: boolean;
  schoolId: number | null;
  schoolName?: string | null;
}

export type Score = 0 | 0.5 | 1;
