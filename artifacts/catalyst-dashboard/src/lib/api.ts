import type { Observation, InstantAnalysisStructured } from "@workspace/api-types";

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
  LatestActionStepRow,
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

export async function bulkImportPeople(
  people: BulkImportPersonPayload[],
  opts: { acknowledgeEmailChanges?: boolean } = {},
): Promise<BulkImportPersonResult> {
  /*
   * Envelope form rather than a bare array. Without it there is no way to
   * acknowledge a sign-in address change, so any file containing one is
   * refused with a 409 the operator cannot resolve. Omitting schoolYearId
   * still targets the active year, which is what a mid-year import wants.
   */
  return apiFetch<BulkImportPersonResult>("/people/bulk", {
    method: "POST",
    body: JSON.stringify({
      rows: people,
      acknowledgeEmailChanges: opts.acknowledgeEmailChanges === true,
    }),
  });
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
  /** Machine-readable reason, e.g. EMAIL_CHANGES_NOT_ACKNOWLEDGED. */
  code?: string;
  /** Carried on a 409 from /people/bulk so the caller can show what changed. */
  emailChanges?: { employeeId: string; name: string; from: string; to: string }[];
  /** Carried on a 409 from DELETE /observations so the caller can name what
      would be lost before asking. */
  stepsToDelete?: ObservationStepImpact[];
  stepsToMove?:   ObservationStepImpact[];
  constructor(
    status: number,
    message: string,
    extra?: {
      scoreCount?: number;
      observationCount?: number;
      code?: string;
      emailChanges?: { employeeId: string; name: string; from: string; to: string }[];
      stepsToDelete?: ObservationStepImpact[];
      stepsToMove?:   ObservationStepImpact[];
    },
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    if (extra?.scoreCount !== undefined) this.scoreCount = extra.scoreCount;
    if (extra?.observationCount !== undefined) this.observationCount = extra.observationCount;
    if (extra?.code !== undefined) this.code = extra.code;
    if (extra?.emailChanges !== undefined) this.emailChanges = extra.emailChanges;
    if (extra?.stepsToDelete !== undefined) this.stepsToDelete = extra.stepsToDelete;
    if (extra?.stepsToMove !== undefined) this.stepsToMove = extra.stepsToMove;
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

/* ── Centralized "not active this year" handler ────────────────────────────
   requireAuth returns 403 NOT_ACTIVE_THIS_YEAR when somebody is marked active
   but holds no open assignment in the current school year. GET /auth/me does
   NOT apply that gate, so such a person gets a valid session and a rendered
   dashboard, and then every data call 403s at once — which showed up in
   production as a few seconds of empty dashboard followed by a white screen.

   Handled centrally, like 401, so it lands on a page that says what happened
   instead of dying in whichever query returned first.                       */
let _notActiveThisYearHandler: (() => void) | null = null;

export function setNotActiveThisYearHandler(fn: (() => void) | null): void {
  _notActiveThisYearHandler = fn;
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
    let extra: {
      scoreCount?: number; observationCount?: number;
      code?: string; emailChanges?: RosterEmailChange[];
      stepsToDelete?: ObservationStepImpact[]; stepsToMove?: ObservationStepImpact[];
    } | undefined;
    try {
      const body = JSON.parse(text) as {
        error?: string; scoreCount?: number; observationCount?: number;
        code?: string; emailChanges?: RosterEmailChange[];
        stepsToDelete?: ObservationStepImpact[]; stepsToMove?: ObservationStepImpact[];
      };
      message = body.error ?? res.statusText;
      if (body.scoreCount !== undefined || body.observationCount !== undefined
          || body.code !== undefined || body.emailChanges !== undefined
          || body.stepsToDelete !== undefined) {
        extra = {};
        if (body.scoreCount !== undefined) extra.scoreCount = body.scoreCount;
        if (body.observationCount !== undefined) extra.observationCount = body.observationCount;
        if (body.code !== undefined) extra.code = body.code;
        if (body.emailChanges !== undefined) extra.emailChanges = body.emailChanges;
        if (body.stepsToDelete !== undefined) extra.stepsToDelete = body.stepsToDelete;
        if (body.stepsToMove !== undefined) extra.stepsToMove = body.stepsToMove;
      }
    } catch { message = text || res.statusText; }
    const err = new HttpError(res.status, message, extra);
    if (res.status === 403 && extra?.code === "NOT_ACTIVE_THIS_YEAR" && _notActiveThisYearHandler) {
      _notActiveThisYearHandler();
    }
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

/* ── School profile ────────────────────────────────────────────── */

import type { SchoolObservationHistory } from "@workspace/api-types";

/**
 * One school's school-wide observation history.
 *
 * The district summary answers "how are the schools doing" with averages and
 * nothing behind them. This answers what actually happened at one school, and
 * is what the school profile page is built on.
 */
export async function fetchSchoolObservations(
  schoolId: number,
  rubricSetSlug: string,
): Promise<SchoolObservationHistory> {
  return apiFetch<SchoolObservationHistory>(
    `/district/schools/${schoolId}/observations?rubricSet=${encodeURIComponent(rubricSetSlug)}`,
  );
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

export async function createObservation(payload: CreateObservationPayload): Promise<Observation & { masteryWarning?: string }> {
  return apiFetch<Observation & { masteryWarning?: string }>("/observations", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateObservation(id: string, payload: UpdateObservationPayload): Promise<Observation & { masteryWarning?: string }> {
  return apiFetch<Observation & { masteryWarning?: string }>(`/observations/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

/** What deleting an observation would do, asked before anybody is told. */
export async function fetchDeleteImpact(id: string): Promise<{
  stepsToDelete: ObservationStepImpact[];
  stepsToMove:   ObservationStepImpact[];
}> {
  return apiFetch(`/observations/${id}/delete-impact`);
}

export interface ObservationStepImpact {
  id:       number;
  text:     string;
  mastered: boolean;
}

/* Thrown as HttpError 409 with code ACTION_STEPS_WOULD_BE_DELETED when the
   observation has action steps that would go with it. Call again with
   force = true once the person has been told. */
export interface DeleteObservationBlocked {
  stepsToDelete: ObservationStepImpact[];
  stepsToMove:   ObservationStepImpact[];
}

export async function deleteObservation(
  id: string,
  force = false,
): Promise<{ ok: boolean; id: string; deletedActionSteps?: number; movedActionSteps?: number }> {
  return apiFetch(`/observations/${id}${force ? "?force=true" : ""}`, {
    method: "DELETE",
  });
}

/* ── System settings ──────────────────────────────────────────────
   The two network-wide windows. Readable by anyone signed in — the Action
   Center states them in its own copy — but only network admins may write. */
export async function fetchSystemSettings(): Promise<import("@workspace/api-types").SystemSettings> {
  return apiFetch("/system-settings");
}

/** What a change would do, before making it. Network admins only. */
export async function previewSystemSettings(
  next: { rescoreWindowDays?: number; overdueWindowDays?: number },
): Promise<import("@workspace/api-types").SystemSettingsPreview> {
  const qs = new URLSearchParams();
  if (next.rescoreWindowDays !== undefined) qs.set("rescoreWindowDays", String(next.rescoreWindowDays));
  if (next.overdueWindowDays !== undefined) qs.set("overdueWindowDays", String(next.overdueWindowDays));
  return apiFetch(`/system-settings/preview?${qs.toString()}`);
}

export async function updateSystemSettings(
  next: { rescoreWindowDays?: number; overdueWindowDays?: number },
): Promise<import("@workspace/api-types").SystemSettings & { recalculated: number }> {
  return apiFetch("/system-settings", { method: "PUT", body: JSON.stringify(next) });
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
    if (res.status === 403
        && (err as { code?: string }).code === "NOT_ACTIVE_THIS_YEAR"
        && _notActiveThisYearHandler) {
      _notActiveThisYearHandler();
    }
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

import type { ActionStep, OverdueActionStep, LatestActionStepRow, UsageReport } from "@workspace/api-types";

export async function fetchLatestActionStep(teacherEmployeeId: string): Promise<ActionStep | null> {
  return apiFetch<ActionStep | null>(`/action-steps/latest?teacherEmployeeId=${encodeURIComponent(teacherEmployeeId)}`);
}

export async function fetchActionSteps(teacherEmployeeId: string): Promise<ActionStep[]> {
  return apiFetch<ActionStep[]>(`/action-steps?teacherEmployeeId=${encodeURIComponent(teacherEmployeeId)}`);
}

export async function masterActionStep(id: number): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/action-steps/${id}/master`, { method: "PATCH" });
}

/** Put a mastered step back to open. Mastery used to be one-way. */
export async function unmasterActionStep(id: number): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/action-steps/${id}/unmaster`, { method: "PATCH" });
}

export async function fetchUsage(schoolId?: number | null): Promise<UsageReport> {
  const qs = schoolId != null ? `?schoolId=${schoolId}` : "";
  return apiFetch<UsageReport>(`/usage${qs}`);
}

export async function fetchOverdueActionSteps(schoolId?: number | null): Promise<OverdueActionStep[]> {
  const qs = schoolId != null ? `?schoolId=${schoolId}` : "";
  return apiFetch<OverdueActionStep[]>(`/action-steps/overdue${qs}`);
}

/**
 * The whole roster with each teacher's most recent action step.
 *
 * Note the singular fetchLatestActionStep above is a different thing: one
 * teacher, for their profile page. This one is the Action Center tab.
 */
export async function fetchLatestActionStepRoster(schoolId?: number | null): Promise<LatestActionStepRow[]> {
  const qs = schoolId != null ? `?schoolId=${schoolId}` : "";
  return apiFetch<LatestActionStepRow[]>(`/action-center/latest-action-steps${qs}`);
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

/* ── Admin: school-year rollover ─────────────────────────────────── */

import type { BulkImportPersonRowResult } from "@workspace/api-types";

/** The preconditions the activation gate enforces. */
export interface ActivationReadiness {
  ready:        boolean;
  hasRoster:    boolean;
  hasRubricSet: boolean;
  blockers:     string[];
}

export async function fetchActivationReadiness(yearId: number): Promise<ActivationReadiness> {
  return apiFetch<ActivationReadiness>(`/admin/school-years/${yearId}/readiness`);
}

export interface RosterSchoolBreakdown {
  schoolId:    number;
  schoolName:  string;
  newHires:    number;
  schoolMoves: number;
  roleChanges: number;
  unchanged:   number;
  departures:  number;
  /** Headcount this school will have in the target year. Zero is the signal
      that the school is missing from the file, not that everyone resigned. */
  remaining:   number;
}

export interface RosterDeparture {
  employeeId: string;
  name:       string;
  email:      string;
  schoolId:   number | null;
  schoolName: string | null;
}

export interface RosterEmailChange {
  employeeId: string;
  name:       string;
  from:       string;
  to:         string;
}

export interface RosterRowError {
  row:    number;
  status: "error";
  name?:  string;
  email?: string;
  reason: string;
}

export interface RosterCounts {
  newHires:    number;
  schoolMoves: number;
  roleChanges: number;
  unchanged:   number;
  departures:  number;
  errors:      number;
  /** Active staff absent from this roster whose departure cannot be detected,
      because they hold no assignment in the outgoing year. Non-zero means the
      departure list is incomplete. */
  undetectable: number;
  /** Rows matched only after ignoring leading zeros in the employee ID —
      i.e. the export dropped the padding HR applies. */
  idNormalised: number;
  /** People whose sign-in address this roster would change. */
  emailChanges: number;
}

export interface RosterDiff {
  dryRun:         true;
  targetYearId:   number;
  outgoingYearId: number | null;
  staged:         boolean;
  counts:         RosterCounts;
  bySchool:       RosterSchoolBreakdown[];
  departures:     RosterDeparture[];
  emailChanges:   RosterEmailChange[];
  errors:         RosterRowError[];
}

export interface RosterApplyResult {
  results:      BulkImportPersonRowResult[];
  targetYearId: number;
  staged:       boolean;
  counts:       RosterCounts;
}

/**
 * Compute the roster diff without writing anything.
 *
 * The response is normalised before it is returned. The browser reloads on a
 * pull while the API server keeps running whatever it started with, so the UI
 * routinely sees a response from an older server than itself. Reading .length
 * off a field that version did not send takes down the whole panel — with a
 * runtime error that says nothing about the actual cause.
 */
export async function previewRoster(
  yearId: number,
  rows: BulkImportPersonPayload[],
): Promise<RosterDiff> {
  const raw = await apiFetch<Partial<RosterDiff>>("/people/bulk", {
    method: "POST",
    body: JSON.stringify({ rows, schoolYearId: yearId, dryRun: true }),
  });
  return {
    dryRun:         true,
    targetYearId:   raw.targetYearId ?? yearId,
    outgoingYearId: raw.outgoingYearId ?? null,
    staged:         raw.staged ?? false,
    bySchool:       raw.bySchool ?? [],
    departures:     raw.departures ?? [],
    emailChanges:   raw.emailChanges ?? [],
    errors:         raw.errors ?? [],
    counts: {
      newHires:     raw.counts?.newHires     ?? 0,
      schoolMoves:  raw.counts?.schoolMoves  ?? 0,
      roleChanges:  raw.counts?.roleChanges  ?? 0,
      unchanged:    raw.counts?.unchanged    ?? 0,
      departures:   raw.counts?.departures   ?? 0,
      errors:       raw.counts?.errors       ?? 0,
      undetectable: raw.counts?.undetectable ?? 0,
      idNormalised: raw.counts?.idNormalised ?? 0,
      emailChanges: raw.counts?.emailChanges ?? 0,
    },
  };
}

/** Write the roster. Staged when yearId is not the active year. */
export async function stageRoster(
  yearId: number,
  rows: BulkImportPersonPayload[],
  opts: { acknowledgeEmailChanges?: boolean } = {},
): Promise<RosterApplyResult> {
  return apiFetch<RosterApplyResult>("/people/bulk", {
    method: "POST",
    body: JSON.stringify({
      rows,
      schoolYearId: yearId,
      acknowledgeEmailChanges: opts.acknowledgeEmailChanges === true,
    }),
  });
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

/* ── Platform Notifications ─────────────────────────────────────── */

export type NotificationDisplayMode = "ONCE" | "EVERY_LOGIN";

export interface PlatformNotification {
  id:                  number;
  title:               string;
  body:                string;
  displayMode:         NotificationDisplayMode;
  isActive:            boolean;
  createdByEmployeeId: string | null;
  createdAt:           string;
  updatedAt:           string;
}

/* Admin endpoints */

export async function fetchAdminNotifications(): Promise<PlatformNotification[]> {
  return apiFetch<PlatformNotification[]>("/admin/notifications");
}

export async function createAdminNotification(payload: {
  title:       string;
  body:        string;
  displayMode: NotificationDisplayMode;
  isActive?:   boolean;
}): Promise<PlatformNotification> {
  return apiFetch<PlatformNotification>("/admin/notifications", {
    method: "POST",
    body:   JSON.stringify(payload),
  });
}

export async function updateAdminNotification(
  id: number,
  payload: Partial<{ title: string; body: string; displayMode: NotificationDisplayMode; isActive: boolean }>,
): Promise<PlatformNotification> {
  return apiFetch<PlatformNotification>(`/admin/notifications/${id}`, {
    method: "PATCH",
    body:   JSON.stringify(payload),
  });
}

export async function deleteAdminNotification(id: number): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/admin/notifications/${id}`, { method: "DELETE" });
}

/* User-facing endpoints */

export async function fetchActiveNotifications(): Promise<PlatformNotification[]> {
  return apiFetch<PlatformNotification[]>("/notifications/active");
}

export async function dismissNotification(id: number, permanent: boolean): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/notifications/${id}/dismiss`, {
    method: "POST",
    body:   JSON.stringify({ permanent }),
  });
}
