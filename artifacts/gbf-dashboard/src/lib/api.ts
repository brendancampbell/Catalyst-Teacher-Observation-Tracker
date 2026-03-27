import type { Score, Teacher, Observation } from "../data/dummy";

/* ── Users ─────────────────────────────────────────────────────── */

export type UserRole = "COACH" | "PRINCIPAL" | "DISTRICT_ADMIN";

export interface UserRow {
  id:         number;
  email:      string;
  name:       string;
  role:       UserRole;
  schoolId:   number | null;
  schoolName: string | null;
}

export async function fetchUsers(): Promise<UserRow[]> {
  return apiFetch<UserRow[]>("/users");
}

/* ── Admin: Schools ─────────────────────────────────────────────── */

export interface AdminSchool {
  id:   number;
  name: string;
}

export async function fetchAdminSchools(): Promise<AdminSchool[]> {
  return apiFetch<AdminSchool[]>("/admin/schools");
}

export async function createAdminSchool(name: string): Promise<AdminSchool> {
  return apiFetch<AdminSchool>("/admin/schools", { method: "POST", body: JSON.stringify({ name }) });
}

export async function updateAdminSchool(id: number, name: string): Promise<AdminSchool> {
  return apiFetch<AdminSchool>(`/admin/schools/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
}

export async function deleteAdminSchool(id: number): Promise<void> {
  await apiFetch<void>(`/admin/schools/${id}`, { method: "DELETE" });
}

/* ── Admin: Teachers ────────────────────────────────────────────── */

export interface AdminTeacher {
  id:         number;
  name:       string;
  subject:    string;
  gradeLevel: string[];
  isActive:   boolean;
  schoolId:   number | null;
  schoolName: string | null;
}

export async function fetchAdminTeachers(): Promise<AdminTeacher[]> {
  return apiFetch<AdminTeacher[]>("/admin/teachers");
}

export async function createAdminTeacher(payload: { name: string; subject: string; gradeLevel: string[]; schoolId?: number | null }): Promise<AdminTeacher> {
  return apiFetch<AdminTeacher>("/admin/teachers", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateAdminTeacher(id: number, payload: { name?: string; subject?: string; gradeLevel?: string[]; schoolId?: number | null }): Promise<AdminTeacher> {
  return apiFetch<AdminTeacher>(`/admin/teachers/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function toggleTeacherActive(id: number): Promise<AdminTeacher> {
  return apiFetch<AdminTeacher>(`/admin/teachers/${id}/toggle-active`, { method: "PATCH" });
}

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

/* ── District ────────────────────────────────────────────────── */

export interface DistrictSchoolRow {
  id:            number;
  name:          string;
  teacherCount:  number;
  observedCount: number;
  domainAverages: Record<string, number | null>;
  overall:       number | null;
}

export interface DistrictSummaryData {
  quarter:    QuarterInfo;
  categories: CategoryEntry[];
  schools:    DistrictSchoolRow[];
}

export async function fetchDistrictSummary(quarter = "Q1"): Promise<DistrictSummaryData> {
  return apiFetch<DistrictSummaryData>(`/district/summary?quarter=${quarter}`);
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
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

/* ── Dashboard ─────────────────────────────────────────────────── */

export async function fetchDashboard(quarter = "Q1", schoolId?: number | null): Promise<DashboardData> {
  const params = new URLSearchParams({ quarter });
  if (schoolId != null) params.set("schoolId", String(schoolId));
  return apiFetch<DashboardData>(`/dashboard?${params.toString()}`);
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

export async function createQuarter(slug: string, name: string, copyFromSlug?: string): Promise<RubricQuarterRow> {
  return apiFetch<RubricQuarterRow>("/rubric/quarters", {
    method: "POST",
    body: JSON.stringify({ slug, name, ...(copyFromSlug ? { copyFromSlug } : {}) }),
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
