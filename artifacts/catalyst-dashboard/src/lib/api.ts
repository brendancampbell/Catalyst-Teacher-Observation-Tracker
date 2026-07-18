import type { Score, Teacher, Observation, InstantAnalysisStructured } from "@workspace/api-types";

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
  AIChatSession,
  AIChatMessage,
  InstantAnalysisStructured,
  AIInsightsResponse,
  AICalibrationFlag,
  ActionStep,
  OverdueActionStep,
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

export async function reassignPerson(
  employeeId: string,
  payload: { role: PersonRole; schoolId: number },
): Promise<PersonRow> {
  return apiFetch<PersonRow>(`/people/${encodeURIComponent(employeeId)}/reassign`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
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

export interface BulkSchoolRow {
  displayName:  string;
  fullName:     string;
  abbreviation: string;
  region:       string;
  gradeSpan:    string;
}

export interface BulkSchoolResult {
  added:   number;
  updated: number;
  failed:  { row: number; error: string }[];
}

export async function bulkImportSchools(rows: BulkSchoolRow[]): Promise<BulkSchoolResult> {
  return apiFetch<BulkSchoolResult>("/admin/schools/bulk", { method: "POST", body: JSON.stringify(rows) });
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

export async function deleteRubricSet(slug: string, force?: boolean): Promise<void> {
  const qs = force ? "?force=true" : "";
  await apiFetch<void>(`/rubric/sets/${slug}${qs}`, { method: "DELETE" });
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

export async function deleteCategory(id: number, force?: boolean): Promise<void> {
  const qs = force ? "?force=true" : "";
  await apiFetch<void>(`/rubric/categories/${id}${qs}`, { method: "DELETE" });
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

export async function updateDomain(id: number, name: string, description?: string | null): Promise<RubricDomainRow> {
  return apiFetch<RubricDomainRow>(`/rubric/domains/${id}`, {
    method: "PUT",
    body: JSON.stringify({ name, ...(description !== undefined ? { description } : {}) }),
  });
}

export async function deleteDomain(id: number, force?: boolean): Promise<void> {
  const qs = force ? "?force=true" : "";
  await apiFetch<void>(`/rubric/domains/${id}${qs}`, { method: "DELETE" });
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

export class HttpError extends Error {
  status: number;
  scoreCount?: number;
  observationCount?: number;
  constructor(status: number, message: string, extra?: { scoreCount?: number; observationCount?: number }) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    if (extra?.scoreCount !== undefined) this.scoreCount = extra.scoreCount;
    if (extra?.observationCount !== undefined) this.observationCount = extra.observationCount;
  }
}

/* ── Centralized 401 handler ───────────────────────────────────────────────
   Registered by UserProvider while a user is authenticated.
   Called synchronously before throwing, so the redirect fires before any
   React Query retry or component error state can render.                   */
let _unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null): void {
  _unauthorizedHandler = fn;
}

/* ── Centralized 429 / quota-exhaustion handler ────────────────────────────
   Registered by ActionCenterPage to surface the exhaustion modal whenever
   any AI endpoint returns 429 — including the streaming chat endpoint.     */
let _quotaExhaustedHandler: (() => void) | null = null;

export function setQuotaExhaustedHandler(fn: (() => void) | null): void {
  _quotaExhaustedHandler = fn;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message: string;
    let extra: { scoreCount?: number; observationCount?: number } | undefined;
    try {
      const body = JSON.parse(text) as { error?: string; scoreCount?: number; observationCount?: number };
      message = body.error ?? res.statusText;
      if (body.scoreCount !== undefined || body.observationCount !== undefined) {
        extra = {};
        if (body.scoreCount !== undefined) extra.scoreCount = body.scoreCount;
        if (body.observationCount !== undefined) extra.observationCount = body.observationCount;
      }
    } catch { message = text || res.statusText; }
    const err = new HttpError(res.status, message, extra);
    if (res.status === 401 && _unauthorizedHandler) {
      _unauthorizedHandler();
    }
    if (res.status === 429 && _quotaExhaustedHandler) {
      _quotaExhaustedHandler();
    }
    throw err;
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

import type { AIChatResponse, AIChatSession, AIChatMessage, AIInsightsResponse, AICalibrationFlag } from "@workspace/api-types";

export async function fetchAIChat(message: string, schoolId?: number | null, sessionId?: number | null): Promise<AIChatResponse> {
  return apiFetch<AIChatResponse>("/ai/chat", {
    method: "POST",
    body: JSON.stringify({
      message,
      ...(schoolId  != null ? { schoolId  } : {}),
      ...(sessionId != null ? { sessionId } : {}),
    }),
  });
}

export interface StreamChatMeta {
  matchedTeachers?: string[];
  nextSteps?: string[];
}

export async function streamAIChat(
  message: string,
  schoolId: number | null | undefined,
  sessionId: number | null | undefined,
  onChunk: (token: string) => void,
  signal?: AbortSignal,
  rubricSetSlug?: string | null,
): Promise<StreamChatMeta> {
  const res = await fetch(`${BASE}/api/ai/chat/stream`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      ...(schoolId       != null ? { schoolId       } : {}),
      ...(sessionId      != null ? { sessionId      } : {}),
      ...(rubricSetSlug  != null ? { rubricSetSlug  } : {}),
    }),
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const msg = (err as { error?: string }).error ?? res.statusText;
    const httpErr = new HttpError(res.status, msg);
    if (res.status === 429 && _quotaExhaustedHandler) {
      _quotaExhaustedHandler();
    }
    throw httpErr;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const meta: StreamChatMeta = {};

  try {
    while (true) {
      if (signal?.aborted) { reader.cancel(); break; }
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);
        if (data === "[DONE]") return meta;
        if (data.startsWith("[META]")) {
          try { Object.assign(meta, JSON.parse(data.slice(6))); } catch { /* ignore */ }
          continue;
        }
        try {
          onChunk(JSON.parse(data) as string);
        } catch {
          /* ignore malformed lines */
        }
      }
    }
  } catch (err) {
    /* Re-throw all errors — including AbortError — so the caller's catch
       block decides how to handle them.  Previously AbortError was swallowed
       here and meta was returned, which caused handleSendChat's success path
       to commit the partial text a second time after handleStopGeneration()
       had already committed it (double-bubble bug). */
    throw err;
  }
  /* If the loop exited because the signal was aborted (break path), throw so
     the caller's AbortError guard fires and the success-path commit is skipped. */
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
  return meta;
}

export async function fetchChatSessions(): Promise<AIChatSession[]> {
  return apiFetch<AIChatSession[]>("/ai/chats");
}

export async function createChatSession(firstMessage?: string): Promise<AIChatSession> {
  return apiFetch<AIChatSession>("/ai/chats", {
    method: "POST",
    body: JSON.stringify({ firstMessage }),
  });
}

export async function fetchChatSessionMessages(sessionId: number): Promise<AIChatMessage[]> {
  return apiFetch<AIChatMessage[]>(`/ai/chats/${sessionId}/messages`);
}

export async function renameChatSession(sessionId: number, title: string): Promise<AIChatSession> {
  return apiFetch<AIChatSession>(`/ai/chats/${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export async function deleteChatSession(sessionId: number): Promise<void> {
  await apiFetch<void>(`/ai/chats/${sessionId}`, { method: "DELETE" });
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

export async function generateAIAnalysis(
  rubricSetSlug: string,
  schoolId?: number | null,
  sessionId?: number | null,
): Promise<{ structured: InstantAnalysisStructured; rubricSetSlug: string }> {
  return apiFetch<{ structured: InstantAnalysisStructured; rubricSetSlug: string }>("/ai/analysis", {
    method: "POST",
    body: JSON.stringify({
      rubricSetSlug,
      ...(schoolId  != null ? { schoolId  } : {}),
      ...(sessionId != null ? { sessionId } : {}),
    }),
  });
}

export async function generateQualitativeSummary(
  rubricSetSlug: string,
  schoolId?: number | null,
): Promise<{ summary: string }> {
  return apiFetch<{ summary: string }>("/ai/school-summary", {
    method: "POST",
    body: JSON.stringify({
      rubricSetSlug,
      ...(schoolId != null ? { schoolId } : {}),
    }),
  });
}

/* ── Action Steps ──────────────────────────────────────────────── */

import type { ActionStep, OverdueActionStep } from "@workspace/api-types";

export async function fetchLatestActionStep(teacherEmployeeId: string): Promise<ActionStep | null> {
  return apiFetch<ActionStep | null>(`/action-steps/latest?teacherEmployeeId=${encodeURIComponent(teacherEmployeeId)}`);
}

export async function fetchActionSteps(teacherEmployeeId: string): Promise<ActionStep[]> {
  return apiFetch<ActionStep[]>(`/action-steps?teacherEmployeeId=${encodeURIComponent(teacherEmployeeId)}`);
}

export async function masterActionStep(id: number): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/action-steps/${id}/master`, { method: "PATCH" });
}

export async function fetchOverdueActionSteps(schoolId?: number | null): Promise<OverdueActionStep[]> {
  const qs = schoolId != null ? `?schoolId=${schoolId}` : "";
  return apiFetch<OverdueActionStep[]>(`/action-steps/overdue${qs}`);
}

/* ── Qualitative Themes ─────────────────────────────────────────── */

export type {
  QualitativeTheme,
  QualitativeThemesResult,
  QualitativeThemesCacheResponse,
} from "@workspace/api-types";

import type {
  QualitativeThemesResult,
  QualitativeThemesCacheResponse,
} from "@workspace/api-types";

export async function fetchQualitativeThemes(
  schoolId: number | string,
  rubricSlug: string,
): Promise<QualitativeThemesCacheResponse> {
  return apiFetch<QualitativeThemesCacheResponse>(
    `/qualitative-themes?schoolId=${schoolId}&rubricSlug=${encodeURIComponent(rubricSlug)}`,
  );
}

export async function generateQualitativeThemes(
  schoolId: number | string,
  rubricSlug: string,
): Promise<QualitativeThemesResult> {
  return apiFetch<QualitativeThemesResult>("/qualitative-themes/generate", {
    method: "POST",
    body:   JSON.stringify({ schoolId, rubricSlug }),
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

/* ── Admin: School Years ─────────────────────────────────────────── */

import type { SchoolYearRow, SchoolYearActivationPreview } from "@workspace/api-types";
export type { SchoolYearRow, SchoolYearActivationPreview };

export async function fetchSchoolYears(): Promise<SchoolYearRow[]> {
  return apiFetch<SchoolYearRow[]>("/admin/school-years");
}

export async function createSchoolYear(name: string): Promise<SchoolYearRow> {
  return apiFetch<SchoolYearRow>("/admin/school-years", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function fetchSchoolYearRubricSets(yearId: number): Promise<RubricSetRow[]> {
  return apiFetch<RubricSetRow[]>(`/admin/school-years/${yearId}/rubric-sets`);
}

export async function fetchActivationPreview(yearId: number): Promise<SchoolYearActivationPreview> {
  return apiFetch<SchoolYearActivationPreview>(`/admin/school-years/${yearId}/activation-preview`);
}

export async function activateSchoolYear(yearId: number): Promise<SchoolYearRow> {
  return apiFetch<SchoolYearRow>(`/admin/school-years/${yearId}/activate`, { method: "POST" });
}

export async function reorderSchoolYears(items: { id: number; displayOrder: number }[]): Promise<SchoolYearRow[]> {
  return apiFetch<SchoolYearRow[]>("/admin/school-years/reorder", {
    method: "PUT",
    body: JSON.stringify(items),
  });
}

export async function copyRubricSetForward(sourceSetId: number, targetSchoolYearId: number): Promise<RubricSetRow> {
  return apiFetch<RubricSetRow>(`/rubric/sets/${sourceSetId}/copy-forward`, {
    method: "POST",
    body: JSON.stringify({ targetSchoolYearId }),
  });
}

/* ── AI Quota Status ─────────────────────────────────────────────── */

export interface AIQuotaStatus {
  chat:       { remaining: number; windowRemaining: number; hasGrant: boolean };
  generation: { remaining: number; windowRemaining: number; hasGrant: boolean };
}

export async function fetchAIQuotaStatus(): Promise<AIQuotaStatus> {
  return apiFetch<AIQuotaStatus>("/ai/usage-status");
}

/* ── AI Quota Grants ─────────────────────────────────────────────── */

import type { AIQuotaGrant, AIQuotaGrantType, AIQuotaGrantWithPerson } from "@workspace/api-types";
export type { AIQuotaGrant, AIQuotaGrantType, AIQuotaGrantWithPerson };

export async function fetchAIQuotaGrants(employeeId: string, includeAll = true): Promise<AIQuotaGrant[]> {
  const qs = includeAll ? "?all=true" : "";
  return apiFetch<AIQuotaGrant[]>(`/ai/quota-grants/${encodeURIComponent(employeeId)}${qs}`);
}

export async function fetchAllAIQuotaGrants(includeAll = false): Promise<AIQuotaGrantWithPerson[]> {
  const qs = includeAll ? "?all=true" : "";
  return apiFetch<AIQuotaGrantWithPerson[]>(`/ai/quota-grants${qs}`);
}

export async function createAIQuotaGrant(payload: {
  employeeId:     string;
  grantType:      AIQuotaGrantType;
  extraRequests:  number;
  expiresInHours: number;
  note?:          string;
}): Promise<AIQuotaGrant> {
  return apiFetch<AIQuotaGrant>("/ai/quota-grants", {
    method: "POST",
    body:   JSON.stringify(payload),
  });
}

export async function revokeAIQuotaGrant(id: number): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/ai/quota-grants/${id}`, { method: "DELETE" });
}
