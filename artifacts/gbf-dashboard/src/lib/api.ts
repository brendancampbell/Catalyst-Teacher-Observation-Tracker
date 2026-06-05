import type { Score, Teacher, Observation } from "../data/dummy";

/* ── Users ─────────────────────────────────────────────────────── */

export type UserRole = "COACH" | "SCHOOL_LEADER" | "NETWORK_LEADER" | "NETWORK_ADMIN";

export interface UserRow {
  id:         number;
  email:      string;
  name:       string;
  role:       UserRole;
  schoolId:   number | null;
  schoolName: string | null;
  isActive:   boolean;
}

export async function fetchUsers(): Promise<UserRow[]> {
  return apiFetch<UserRow[]>("/users");
}

export async function startImpersonation(userId: number): Promise<void> {
  await apiFetch<{ ok: boolean }>("/auth/impersonate", {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
}

export async function stopImpersonation(): Promise<void> {
  await apiFetch<{ ok: boolean }>("/auth/stop-impersonating", { method: "POST" });
}

export async function createUser(payload: { email: string; name: string; role: UserRole; schoolId?: number | null }): Promise<UserRow> {
  return apiFetch<UserRow>("/users", { method: "POST", body: JSON.stringify(payload) });
}

export async function updateUser(id: number, payload: Partial<{ email: string; name: string; role: UserRole; schoolId: number | null }>): Promise<UserRow> {
  return apiFetch<UserRow>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export async function toggleUserActive(id: number): Promise<UserRow> {
  return apiFetch<UserRow>(`/users/${id}/toggle-active`, { method: "PATCH" });
}

export interface BulkImportRowResult {
  row:    number;
  status: "created" | "skipped" | "error";
  email?: string;
  name?:  string;
  reason?: string;
}

export interface BulkImportResult {
  results: BulkImportRowResult[];
}

export interface BulkImportUserPayload {
  name:   string;
  email:  string;
  role:   string;
  school: string;
}

export async function bulkImportUsers(users: BulkImportUserPayload[]): Promise<BulkImportResult> {
  return apiFetch<BulkImportResult>("/users/bulk", { method: "POST", body: JSON.stringify(users) });
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
  firstName:  string;
  lastName:   string;
  name:       string;
  employeeId: string | null;
  email:      string | null;
  subject:    string;
  gradeLevel: string[];
  isActive:   boolean;
  schoolId:   number | null;
  schoolName: string | null;
}

export async function fetchAdminTeachers(): Promise<AdminTeacher[]> {
  return apiFetch<AdminTeacher[]>("/admin/teachers");
}

export async function createAdminTeacher(payload: {
  firstName:   string;
  lastName:    string;
  employeeId?: string | null;
  email:       string;
  subject:     string;
  gradeLevel:  string[];
  schoolId?:   number | null;
}): Promise<AdminTeacher> {
  return apiFetch<AdminTeacher>("/admin/teachers", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateAdminTeacher(id: number, payload: {
  firstName?:  string;
  lastName?:   string;
  employeeId?: string | null;
  email?:      string;
  subject?:    string;
  gradeLevel?: string[];
  schoolId?:   number | null;
}): Promise<AdminTeacher> {
  return apiFetch<AdminTeacher>(`/admin/teachers/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function toggleTeacherActive(id: number): Promise<AdminTeacher> {
  return apiFetch<AdminTeacher>(`/admin/teachers/${id}/toggle-active`, { method: "PATCH" });
}

export interface BulkImportTeacherPayload {
  firstName:  string;
  lastName:   string;
  employeeId: string;
  subject:    string;
  gradeLevel: string;
  school:     string;
  email:      string;
}

export interface BulkImportTeacherRowResult {
  row:     number;
  status:  "created" | "skipped" | "error";
  name?:   string;
  reason?: string;
}

export interface BulkImportTeacherResult {
  results: BulkImportTeacherRowResult[];
}

export async function bulkImportTeachers(teachers: BulkImportTeacherPayload[]): Promise<BulkImportTeacherResult> {
  return apiFetch<BulkImportTeacherResult>("/admin/teachers/bulk", { method: "POST", body: JSON.stringify(teachers) });
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
    credentials: "include",
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
  time?:        string;
  course?:      string;
  strengths?:   string;
  growthAreas?: string;
  observer?:    string;
  observerId?:  number;
  isWalkthrough?: boolean;
  scores?:      Record<string, Score>;
  status?:      "draft" | "published";
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
  status?:      "draft" | "published";
}

export async function updateObservation(id: string, payload: UpdateObservationPayload): Promise<Observation> {
  return apiFetch<Observation>(`/observations/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteObservation(id: string): Promise<{ ok: boolean; id: string }> {
  return apiFetch<{ ok: boolean; id: string }>(`/observations/${id}`, {
    method: "DELETE",
  });
}

export interface DraftObservation {
  id:            string;
  teacherId:     string;
  rubricSetId:   number;
  date:          string;
  time?:         string;
  course?:       string;
  isWalkthrough: boolean;
  strengths?:    string;
  growthAreas?:  string;
  observer:      string;
  status:        "draft";
  scores:        Record<string, Score>;
}

export async function fetchMyDrafts(): Promise<DraftObservation[]> {
  return apiFetch<DraftObservation[]>("/observations/drafts");
}

export async function fetchMyLatestRubricSlug(): Promise<string | null> {
  const result = await apiFetch<{ slug: string | null }>("/observations/my-latest-rubric");
  return result.slug;
}

/* ── Rubric Sets (admin) ───────────────────────────────────────── */

export interface RubricSetRow {
  id:           number;
  slug:         string;
  name:         string;
  isActive:     boolean;
  isArchived:   boolean;
  gradeSpan:    string | null;
  description:  string | null;
  displayOrder: number;
}

/** @deprecated Use RubricSetRow */
export type RubricQuarterRow = RubricSetRow;

export async function fetchRubricSets(includeArchived = false): Promise<RubricSetRow[]> {
  const qs = includeArchived ? "?includeArchived=true" : "";
  return apiFetch<RubricSetRow[]>(`/rubric/sets${qs}`);
}

/** @deprecated Use fetchRubricSets */
export const fetchQuarters = fetchRubricSets;

export async function updateRubricSet(slug: string, fields: { name?: string; description?: string; isArchived?: boolean }): Promise<RubricSetRow> {
  return apiFetch<RubricSetRow>(`/rubric/sets/${slug}`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });
}

export async function archiveRubricSet(slug: string, archive: boolean): Promise<RubricSetRow> {
  return updateRubricSet(slug, { isArchived: archive });
}

export async function reorderRubricSets(items: { slug: string; displayOrder: number }[]): Promise<RubricSetRow[]> {
  return apiFetch<RubricSetRow[]>("/rubric/sets/reorder", {
    method: "PUT",
    body: JSON.stringify(items),
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

export async function createDomain(categoryId: number, name: string, slug: string, displayOrder: number, description?: string): Promise<RubricDomainRow> {
  return apiFetch<RubricDomainRow>(`/rubric/categories/${categoryId}/domains`, {
    method: "POST",
    body: JSON.stringify({ name, slug, displayOrder, ...(description ? { description } : {}) }),
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

/* ── AI ────────────────────────────────────────────────────────── */

export interface AIChatResponse {
  reply: string;
}

export interface AITrendingStep {
  pct:     number;
  domain:  string;
  avg:     number;
  insight: string;
}

export interface AIInsightsResponse {
  topStrength:   { domain: string; avg: number; count: number } | null;
  topGrowth:     { domain: string; avg: number; count: number } | null;
  trendingSteps: AITrendingStep[];
}

export interface AICalibrationFlag {
  teacher?:     string;
  school?:      string;
  domain:       string;
  schoolScore:  number;
  networkScore: number;
  delta:        number;
}

export interface AIPlateauAlert {
  teacherName: string;
  subject:     string;
  gradeLevel:  string[];
  domain:      string;
  score:       number;
  obsCount:    number;
  firstDate:   string;
  lastDate:    string;
  weekRange:   string;
}

export async function fetchAIChat(message: string): Promise<AIChatResponse> {
  return apiFetch<AIChatResponse>("/ai/chat", {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

export async function fetchAIInsights(): Promise<AIInsightsResponse> {
  return apiFetch<AIInsightsResponse>("/ai/insights");
}

export async function fetchAICalibrationFlags(): Promise<AICalibrationFlag[]> {
  return apiFetch<AICalibrationFlag[]>("/ai/calibration-flags");
}

export async function fetchAIPlateauAlerts(): Promise<AIPlateauAlert[]> {
  return apiFetch<AIPlateauAlert[]>("/ai/plateau-alerts");
}

/* ── Email ──────────────────────────────────────────────────────── */

export async function sendObservationEmail(payload: {
  observationId: string;
  intro: string;
  glows: string;
  grows: string;
  subject: string;
  teacherEmail: string;
  logoUrl: string;
}): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>("/email/send-observation", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
