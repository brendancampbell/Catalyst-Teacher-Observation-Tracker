import type { Score, Teacher, Observation } from "../data/dummy";

export interface DomainEntry {
  id: string;
  label: string;
}

export interface CategoryEntry {
  id: string;
  label: string;
  domains: DomainEntry[];
}

export interface QuarterInfo {
  id: number;
  slug: string;
  name: string;
}

export interface DashboardData {
  quarter: QuarterInfo;
  categories: CategoryEntry[];
  teachers: Teacher[];
}

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

/* ── Dashboard ─────────────────────────────────────────────────── */

export async function fetchDashboard(quarter = "Q1"): Promise<DashboardData> {
  return apiFetch<DashboardData>(`/dashboard?quarter=${quarter}`);
}

/* ── Observations ──────────────────────────────────────────────── */

export interface CreateObservationPayload {
  teacherId: string;
  quarterId: number;
  date: string;
  strengths?: string;
  growthAreas?: string;
  observer?: string;
  scores: Record<string, Score>;
}

export async function createObservation(payload: CreateObservationPayload): Promise<Observation> {
  return apiFetch<Observation>("/observations", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export interface UpdateObservationPayload {
  date?: string;
  strengths?: string;
  growthAreas?: string;
  observer?: string;
  scores?: Record<string, Score>;
}

export async function updateObservation(id: string, payload: UpdateObservationPayload): Promise<Observation> {
  return apiFetch<Observation>(`/observations/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

/* ── Rubric (admin) ────────────────────────────────────────────── */

export interface RubricQuarterRow {
  id: number;
  slug: string;
  name: string;
  isActive: boolean;
}

export async function fetchQuarters(): Promise<RubricQuarterRow[]> {
  return apiFetch<RubricQuarterRow[]>("/rubric/quarters");
}

export async function createQuarter(slug: string, name: string): Promise<RubricQuarterRow> {
  return apiFetch<RubricQuarterRow>("/rubric/quarters", {
    method: "POST",
    body: JSON.stringify({ slug, name }),
  });
}

export interface RubricCategoryRow {
  id: number;
  quarterId: number;
  name: string;
  displayOrder: number;
}

export interface RubricDomainRow {
  id: number;
  categoryId: number;
  name: string;
  slug: string;
  displayOrder: number;
}

export interface FullRubric {
  quarter: RubricQuarterRow;
  categories: (RubricCategoryRow & { domains: RubricDomainRow[] })[];
}

export async function fetchRubric(quarterSlug: string): Promise<FullRubric> {
  return apiFetch<FullRubric>(`/rubric/${quarterSlug}`);
}

export async function createCategory(quarterSlug: string, name: string, displayOrder: number): Promise<RubricCategoryRow> {
  return apiFetch<RubricCategoryRow>(`/rubric/${quarterSlug}/categories`, {
    method: "POST",
    body: JSON.stringify({ name, displayOrder }),
  });
}

export async function updateCategory(id: number, name: string): Promise<RubricCategoryRow> {
  return apiFetch<RubricCategoryRow>(`/rubric/categories/${id}`, {
    method: "PUT",
    body: JSON.stringify({ name }),
  });
}

export async function deleteCategory(id: number): Promise<void> {
  await apiFetch<void>(`/rubric/categories/${id}`, { method: "DELETE" });
}

export async function createDomain(categoryId: number, name: string, slug: string, displayOrder: number): Promise<RubricDomainRow> {
  return apiFetch<RubricDomainRow>(`/rubric/categories/${categoryId}/domains`, {
    method: "POST",
    body: JSON.stringify({ name, slug, displayOrder }),
  });
}

export async function updateDomain(id: number, name: string, slug: string): Promise<RubricDomainRow> {
  return apiFetch<RubricDomainRow>(`/rubric/domains/${id}`, {
    method: "PUT",
    body: JSON.stringify({ name, slug }),
  });
}

export async function deleteDomain(id: number): Promise<void> {
  await apiFetch<void>(`/rubric/domains/${id}`, { method: "DELETE" });
}
