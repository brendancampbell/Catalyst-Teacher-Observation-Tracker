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

export const REGIONS = ["Boston", "Camden", "NYC", "Newark", "Rochester"] as const;
export type Region = typeof REGIONS[number];

export const GRADE_SPANS = ["ES", "MS", "HS"] as const;
export type GradeSpan = typeof GRADE_SPANS[number];

export interface AdminSchool {
  id:        number;
  name:      string;
  region:    string | null;
  gradeSpan: string | null;
}

export interface SchoolPayload {
  name:      string;
  region?:   string | null;
  gradeSpan?: string | null;
}

export async function fetchAdminSchools(): Promise<AdminSchool[]> {
  return apiFetch<AdminSchool[]>("/admin/schools");
}

export async function createAdminSchool(payload: SchoolPayload): Promise<AdminSchool> {
  return apiFetch<AdminSchool>("/admin/schools", { method: "POST", body: JSON.stringify(payload) });
}

export async function updateAdminSchool(id: number, payload: Partial<SchoolPayload>): Promise<AdminSchool> {
  return apiFetch<AdminSchool>(`/admin/schools/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
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
  id:          string;
  label:       string;
  description?: string;
}

export interface CategoryEntry {
  id: string;
  label: string;
  domains: DomainEntry[];
}

/* ── Rubric Set Info ─────────────────────────────────────────────── */

export interface RubricSetInfo {
  id:        number;
  slug:      string;
  name:      string;
  gradeSpan: string | null;
}

export interface DashboardData {
  rubricSet:  RubricSetInfo;
  categories: CategoryEntry[];
  teachers:   Teacher[];
}

/* ── District ────────────────────────────────────────────────── */

export interface DistrictSchoolRow {
  id:            number;
  name:          string;
  region:        string;
  gradeSpan:     string;
  teacherCount:  number;
  observedCount: number;
  domainAverages: Record<string, number | null>;
  overall:       number | null;
}

export interface DistrictSummaryData {
  rubricSet:  RubricSetInfo;
  categories: CategoryEntry[];
  schools:    DistrictSchoolRow[];
}

export async function fetchDistrictSummary(
  rubricSetSlug = "Q1",
  scoreType: "recent" | "average" | "walkthroughs" = "recent",
): Promise<DistrictSummaryData> {
  const apiScoreType     = scoreType === "walkthroughs" ? "recent" : scoreType;
  const walkthroughsOnly = scoreType === "walkthroughs";
  const params = new URLSearchParams({ rubricSet: rubricSetSlug, scoreType: apiScoreType });
  if (walkthroughsOnly) params.set("walkthroughsOnly", "true");
  return apiFetch<DistrictSummaryData>(`/district/summary?${params.toString()}`);
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

export async function fetchDashboard(rubricSetSlug = "Q1", schoolId?: number | null, walkthroughsOnly?: boolean): Promise<DashboardData> {
  const params = new URLSearchParams({ rubricSet: rubricSetSlug });
  if (schoolId != null) params.set("schoolId", String(schoolId));
  if (walkthroughsOnly) params.set("walkthroughsOnly", "true");
  return apiFetch<DashboardData>(`/dashboard?${params.toString()}`);
}

/* ── Action Center ─────────────────────────────────────────────── */

export interface RescoreQueueItem {
  teacherId:      number;
  teacherName:    string;
  subject:        string;
  gradeLevel:     string[];
  schoolName:     string | null;
  rescoreDueDate: string | null;
  needsRescore:   boolean;
}

export async function fetchRescoreQueue(): Promise<RescoreQueueItem[]> {
  return apiFetch<RescoreQueueItem[]>("/action-center/rescore-queue");
}

/* ── Observations ──────────────────────────────────────────────── */

export interface CreateObservationPayload {
  teacherId:    string;
  rubricSetId:  number;
  date:         string;
  strengths?:   string;
  growthAreas?: string;
  observer?:    string;
  observerId?:  number;
  isWalkthrough?: boolean;
  scores:       Record<string, Score>;
}

export async function createObservation(payload: CreateObservationPayload): Promise<Observation> {
  return apiFetch<Observation>("/observations", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export interface UpdateObservationPayload {
  date?:        string;
  strengths?:   string;
  growthAreas?: string;
  observer?:    string;
  scores?:      Record<string, Score>;
}

export async function updateObservation(id: string, payload: UpdateObservationPayload): Promise<Observation> {
  return apiFetch<Observation>(`/observations/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

/* ── Rubric Sets (admin) ───────────────────────────────────────── */

export interface RubricSetRow {
  id:          number;
  slug:        string;
  name:        string;
  isActive:    boolean;
  gradeSpan:   string | null;
  description: string | null;
}

/** @deprecated Use RubricSetRow */
export type RubricQuarterRow = RubricSetRow;

export async function fetchRubricSets(): Promise<RubricSetRow[]> {
  return apiFetch<RubricSetRow[]>("/rubric/sets");
}

/** @deprecated Use fetchRubricSets */
export const fetchQuarters = fetchRubricSets;

export async function updateRubricSet(slug: string, fields: { name?: string; description?: string }): Promise<RubricSetRow> {
  return apiFetch<RubricSetRow>(`/rubric/sets/${slug}`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
}

export async function createRubricSet(slug: string, name: string, gradeSpan?: string, copyFromSlug?: string): Promise<RubricSetRow> {
  return apiFetch<RubricSetRow>("/rubric/sets", {
    method: "POST",
    body: JSON.stringify({ slug, name, ...(gradeSpan ? { gradeSpan } : {}), ...(copyFromSlug ? { copyFromSlug } : {}) }),
  });
}

/** @deprecated Use createRubricSet */
export function createQuarter(slug: string, name: string, copyFromSlug?: string): Promise<RubricSetRow> {
  return createRubricSet(slug, name, undefined, copyFromSlug);
}

export interface RubricCategoryRow {
  id:           number;
  rubricSetId:  number;
  name:         string;
  displayOrder: number;
}

export interface RubricDomainRow {
  id:           number;
  categoryId:   number;
  name:         string;
  slug:         string;
  displayOrder: number;
  description:  string | null;
}

export interface FullRubric {
  rubricSet:  RubricSetRow;
  categories: (RubricCategoryRow & { domains: RubricDomainRow[] })[];
}

export async function fetchRubric(setSlug: string): Promise<FullRubric> {
  return apiFetch<FullRubric>(`/rubric/${setSlug}`);
}

export async function createCategory(setSlug: string, name: string, displayOrder: number): Promise<RubricCategoryRow> {
  return apiFetch<RubricCategoryRow>(`/rubric/${setSlug}/categories`, {
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

export async function updateDomain(id: number, name: string, slug: string, description?: string | null): Promise<RubricDomainRow> {
  return apiFetch<RubricDomainRow>(`/rubric/domains/${id}`, {
    method: "PUT",
    body: JSON.stringify({ name, slug, ...(description !== undefined ? { description } : {}) }),
  });
}

export async function deleteDomain(id: number): Promise<void> {
  await apiFetch<void>(`/rubric/domains/${id}`, { method: "DELETE" });
}
