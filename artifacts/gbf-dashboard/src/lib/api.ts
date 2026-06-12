import type { Score, Teacher, Observation } from "@workspace/api-types";

export type {
  Score,
  Teacher,
  Observation,
  User,
  UserRole,
  PersonRole,
  PersonRow,
  BulkImportPersonPayload,
  BulkImportPersonRowResult,
  BulkImportPersonResult,
  School,
  AdminSchool,
  SchoolPayload,
  Region,
  GradeSpan,
  RubricSet,
  RubricSetInfo,
  RubricSetRow,
  RubricCategoryRow,
  RubricDomainRow,
  FullRubric,
  RubricDomain,
  RubricCategory,
  DomainEntry,
  CategoryEntry,
  DashboardData,
  DistrictSchoolRow,
  DistrictSummaryData,
  SchoolObservationPayload,
  NetworkAveragesData,
  RescoreQueueItem,
  OverdueTeacher,
  CreateObservationPayload,
  UpdateObservationPayload,
  DraftObservation,
  AIChatResponse,
  AIInsightsResponse,
  AICalibrationFlag,
  AIPlateauAlert,
} from "@workspace/api-types";

export { REGIONS, GRADE_SPANS } from "@workspace/api-types";

/* ── People (unified) ──────────────────────────────────────────── */

import type {
  PersonRow,
  BulkImportPersonPayload,
  BulkImportPersonResult,
} from "@workspace/api-types";

export async function fetchPeople(params?: { includeInFeedbackTracker?: boolean; includeInactive?: boolean }): Promise<PersonRow[]> {
  const qs = new URLSearchParams();
  if (params?.includeInFeedbackTracker != null) qs.set("includeInFeedbackTracker", String(params.includeInFeedbackTracker));
  if (params?.includeInactive) qs.set("includeInactive", "true");
  const q = qs.toString();
  return apiFetch<PersonRow[]>(`/people${q ? `?${q}` : ""}`);
}

export async function startImpersonation(employeeId: string): Promise<void> {
  await apiFetch<{ ok: boolean }>("/auth/impersonate", {
    method: "POST",
    body: JSON.stringify({ employeeId }),
  });
}

export async function stopImpersonation(): Promise<void> {
  await apiFetch<{ ok: boolean }>("/auth/stop-impersonating", { method: "POST" });
}

import type { PersonRole } from "@workspace/api-types";

export async function createPerson(payload: {
  employeeId?:                    string;
  email:                          string;
  firstName:                      string;
  lastName:                       string;
  role:                           PersonRole;
  schoolId?:                      number | null;
  department?:                    string | null;
  gradeLevel?:                    string[];
  includeInFeedbackTracker?:      boolean;
}): Promise<PersonRow> {
  return apiFetch<PersonRow>("/people", { method: "POST", body: JSON.stringify(payload) });
}

export async function updatePerson(employeeId: string, payload: Partial<{
  email:                          string;
  firstName:                      string;
  lastName:                       string;
  role:                           PersonRole;
  schoolId:                       number | null;
  department:                     string | null;
  gradeLevel:                     string[];
  includeInFeedbackTracker:       boolean;
  isActive:                       boolean;
}>): Promise<PersonRow> {
  return apiFetch<PersonRow>(`/people/${encodeURIComponent(employeeId)}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export async function togglePersonActive(employeeId: string): Promise<PersonRow> {
  return apiFetch<PersonRow>(`/people/${encodeURIComponent(employeeId)}/toggle-active`, { method: "PATCH" });
}

export async function bulkImportPeople(people: BulkImportPersonPayload[]): Promise<BulkImportPersonResult> {
  return apiFetch<BulkImportPersonResult>("/people/bulk", { method: "POST", body: JSON.stringify(people) });
}

/* ── Admin: Schools ─────────────────────────────────────────────── */

import type { AdminSchool, SchoolPayload } from "@workspace/api-types";

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

/* ── Rubric Set Info ─────────────────────────────────────────────── */

import type {
  RubricSetRow,
  RubricCategoryRow,
  RubricDomainRow,
  FullRubric,
} from "@workspace/api-types";

export async function fetchRubricSets(includeArchived = false): Promise<RubricSetRow[]> {
  const qs = includeArchived ? "?includeArchived=true" : "";
  return apiFetch<RubricSetRow[]>(`/rubric/sets${qs}`);
}

export async function updateRubricSet(slug: string, fields: { name?: string; slug?: string; description?: string; isArchived?: boolean; gradeSpan?: string | null; target?: "TEACHER" | "SCHOOL"; subjectAudience?: "STEM" | "HUMANITIES" | "ALL" }): Promise<RubricSetRow> {
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

export async function createRubricSet(slug: string, name: string, gradeSpan?: string, copyFromSlug?: string, target?: "TEACHER" | "SCHOOL", subjectAudience?: "STEM" | "HUMANITIES" | "ALL"): Promise<RubricSetRow> {
  return apiFetch<RubricSetRow>("/rubric/sets", {
    method: "POST",
    body: JSON.stringify({ slug, name, ...(gradeSpan ? { gradeSpan } : {}), ...(copyFromSlug ? { copyFromSlug } : {}), ...(target ? { target } : {}), ...(subjectAudience ? { subjectAudience } : {}) }),
  });
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

export async function reorderCategories(items: { id: number; displayOrder: number }[]): Promise<void> {
  await apiFetch<void>("/rubric/categories/reorder", {
    method: "PUT",
    body: JSON.stringify(items),
  });
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

export async function reorderDomains(items: { id: number; displayOrder: number }[]): Promise<void> {
  await apiFetch<void>("/rubric/domains/reorder", {
    method: "PUT",
    body: JSON.stringify(items),
  });
}

/* ── District ────────────────────────────────────────────────────── */

import type { DistrictSummaryData } from "@workspace/api-types";

export async function createSchoolObservation(payload: import("@workspace/api-types").SchoolObservationPayload): Promise<{ id: string }> {
  return apiFetch<{ id: string }>("/observations", {
    method: "POST",
    body: JSON.stringify(payload),
  });
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

import type { NetworkAveragesData } from "@workspace/api-types";

export async function fetchNetworkAverages(rubricSetSlug = "Q1"): Promise<NetworkAveragesData> {
  const params = new URLSearchParams({ rubricSet: rubricSetSlug });
  return apiFetch<NetworkAveragesData>(`/action-center/network-averages?${params.toString()}`);
}

/* ── apiFetch ──────────────────────────────────────────────────── */

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

import type { DashboardData } from "@workspace/api-types";

export async function fetchDashboard(rubricSetSlug = "Q1", schoolId?: number | null, walkthroughsOnly?: boolean): Promise<DashboardData> {
  const params = new URLSearchParams({ rubricSet: rubricSetSlug });
  if (schoolId != null) params.set("schoolId", String(schoolId));
  if (walkthroughsOnly) params.set("walkthroughsOnly", "true");
  return apiFetch<DashboardData>(`/dashboard?${params.toString()}`);
}

/* ── Action Center ─────────────────────────────────────────────── */

import type { RescoreQueueItem, OverdueTeacher } from "@workspace/api-types";

export async function fetchRescoreQueue(schoolId?: number | null): Promise<RescoreQueueItem[]> {
  const qs = schoolId != null ? `?schoolId=${schoolId}` : "";
  return apiFetch<RescoreQueueItem[]>(`/action-center/rescore-queue${qs}`);
}

export async function fetchOverdueObservations(schoolId?: number | null): Promise<OverdueTeacher[]> {
  const qs = schoolId != null ? `?schoolId=${schoolId}` : "";
  return apiFetch<OverdueTeacher[]>(`/action-center/overdue-observations${qs}`);
}

/* ── Observations ──────────────────────────────────────────────── */

import type { CreateObservationPayload, UpdateObservationPayload, DraftObservation } from "@workspace/api-types";

export async function createObservation(payload: CreateObservationPayload): Promise<Observation> {
  return apiFetch<Observation>("/observations", {
    method: "POST",
    body: JSON.stringify(payload),
  });
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

export async function fetchMyDrafts(): Promise<DraftObservation[]> {
  return apiFetch<DraftObservation[]>("/observations/drafts");
}

export async function fetchMyLatestRubricSlug(): Promise<string | null> {
  const result = await apiFetch<{ slug: string | null }>("/observations/my-latest-rubric");
  return result.slug;
}

/* ── AI ────────────────────────────────────────────────────────── */

import type { AIChatResponse, AIInsightsResponse, AICalibrationFlag, AIPlateauAlert } from "@workspace/api-types";

export async function fetchAIChat(message: string, schoolId?: number | null): Promise<AIChatResponse> {
  return apiFetch<AIChatResponse>("/ai/chat", {
    method: "POST",
    body: JSON.stringify({ message, ...(schoolId != null ? { schoolId } : {}) }),
  });
}

export async function fetchAIInsights(rubricSlug?: string, schoolId?: number | null): Promise<AIInsightsResponse> {
  const params = new URLSearchParams();
  if (rubricSlug) params.set("rubric", rubricSlug);
  if (schoolId != null) params.set("schoolId", String(schoolId));
  const qs = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<AIInsightsResponse>(`/ai/insights${qs}`);
}

export async function fetchAICalibrationFlags(rubricSlug?: string, schoolId?: number | null): Promise<AICalibrationFlag[]> {
  const params = new URLSearchParams();
  if (rubricSlug) params.set("rubric", rubricSlug);
  if (schoolId != null) params.set("schoolId", String(schoolId));
  const qs = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<AICalibrationFlag[]>(`/ai/calibration-flags${qs}`);
}

export async function fetchAIPlateauAlerts(rubricSlug?: string, schoolId?: number | null): Promise<AIPlateauAlert[]> {
  const params = new URLSearchParams();
  if (rubricSlug) params.set("rubric", rubricSlug);
  if (schoolId != null) params.set("schoolId", String(schoolId));
  const qs = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<AIPlateauAlert[]>(`/ai/plateau-alerts${qs}`);
}

export async function generateAIAnalysis(rubricSetSlug: string, schoolId?: number | null): Promise<{ narrative: string; rubricSetSlug: string }> {
  return apiFetch<{ narrative: string; rubricSetSlug: string }>("/ai/analysis", {
    method: "POST",
    body: JSON.stringify({ rubricSetSlug, ...(schoolId != null ? { schoolId } : {}) }),
  });
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
