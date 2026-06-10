import type { Score, Teacher, Observation } from "../data/dummy";

/* ── People (unified) ──────────────────────────────────────────── */

export type UserRole   = "COACH" | "SCHOOL_LEADER" | "NETWORK_LEADER" | "NETWORK_ADMIN";
export type PersonRole = "COACH" | "SCHOOL_LEADER" | "NETWORK_LEADER" | "NETWORK_ADMIN" | "NO_ACCESS";

export interface PersonRow {
  employeeId:                  string;
  email:                       string;
  firstName:                   string;
  lastName:                    string;
  name:                        string;
  role:                        PersonRole;
  schoolId:                    number | null;
  schoolName:                  string | null;
  isActive:                    boolean;
  includeInFeedbackTracker:    boolean;
  department:                  string | null;
  gradeLevel:                  string[];
  primaryInstructionalLeaderId: string | null;
}

/** @deprecated Use PersonRow */
export type UserRow = PersonRow;

export async function fetchPeople(params?: { includeInFeedbackTracker?: boolean; includeInactive?: boolean }): Promise<PersonRow[]> {
  const qs = new URLSearchParams();
  if (params?.includeInFeedbackTracker != null) qs.set("includeInFeedbackTracker", String(params.includeInFeedbackTracker));
  if (params?.includeInactive) qs.set("includeInactive", "true");
  const q = qs.toString();
  return apiFetch<PersonRow[]>(`/people${q ? `?${q}` : ""}`);
}

/** @deprecated Use fetchPeople */
export const fetchUsers = () => fetchPeople({ includeInactive: true });

export async function startImpersonation(employeeId: string): Promise<void> {
  await apiFetch<{ ok: boolean }>("/auth/impersonate", {
    method: "POST",
    body: JSON.stringify({ employeeId }),
  });
}

export async function stopImpersonation(): Promise<void> {
  await apiFetch<{ ok: boolean }>("/auth/stop-impersonating", { method: "POST" });
}

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
  primaryInstructionalLeaderId?:  string | null;
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
  primaryInstructionalLeaderId:   string | null;
}>): Promise<PersonRow> {
  return apiFetch<PersonRow>(`/people/${encodeURIComponent(employeeId)}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export async function togglePersonActive(employeeId: string): Promise<PersonRow> {
  return apiFetch<PersonRow>(`/people/${encodeURIComponent(employeeId)}/toggle-active`, { method: "PATCH" });
}

export interface BulkImportPersonPayload {
  firstName:                      string;
  lastName:                       string;
  employeeId:                     string;
  email:                          string;
  role:                           string;
  department:                     string;
  gradeLevel:                     string;
  school:                         string;
  includeInFeedbackTracker?:      string;
  primaryInstructionalLeaderId?:  string;
}

export interface BulkImportPersonRowResult {
  row:     number;
  status:  "created" | "skipped" | "error";
  name?:   string;
  email?:  string;
  reason?: string;
}

export interface BulkImportPersonResult {
  results: BulkImportPersonRowResult[];
}

export async function bulkImportPeople(people: BulkImportPersonPayload[]): Promise<BulkImportPersonResult> {
  return apiFetch<BulkImportPersonResult>("/people/bulk", { method: "POST", body: JSON.stringify(people) });
}

/** @deprecated aliases kept for any remaining callers */
export type BulkImportRowResult    = BulkImportPersonRowResult;
export type BulkImportResult       = BulkImportPersonResult;
export type BulkImportUserPayload  = BulkImportPersonPayload;
export const bulkImportUsers       = bulkImportPeople;

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

/* ── Admin: Teachers (deprecated — use people functions) ────────── */

/** @deprecated Use PersonRow */
export type AdminTeacher = PersonRow & { subject: string };

/** @deprecated Use fetchPeople({ includeInFeedbackTracker: true }) */
export const fetchAdminTeachers = () =>
  fetchPeople({ includeInactive: true }) as Promise<AdminTeacher[]>;

/** @deprecated Use createPerson */
export async function createAdminTeacher(payload: {
  firstName:   string;
  lastName:    string;
  employeeId?: string | null;
  email:       string;
  subject?:    string;
  gradeLevel?: string[];
  schoolId?:   number | null;
}): Promise<AdminTeacher> {
  return createPerson({
    ...payload,
    employeeId:              payload.employeeId ?? undefined,
    role:                    "COACH",
    department:              payload.subject ?? null,
    gradeLevel:              payload.gradeLevel ?? [],
    includeInFeedbackTracker: true,
  }) as Promise<AdminTeacher>;
}

/** @deprecated Use updatePerson */
export async function updateAdminTeacher(id: number | string, payload: {
  firstName?:  string;
  lastName?:   string;
  employeeId?: string | null;
  email?:      string;
  subject?:    string;
  gradeLevel?: string[];
  schoolId?:   number | null;
}): Promise<AdminTeacher> {
  const empId = String(id);
  return updatePerson(empId, {
    ...payload,
    department: payload.subject,
  }) as Promise<AdminTeacher>;
}

/** @deprecated Use togglePersonActive */
export const toggleTeacherActive = (id: number | string) =>
  togglePersonActive(String(id)) as Promise<AdminTeacher>;

/** @deprecated Use BulkImportPersonPayload */
export type BulkImportTeacherPayload = BulkImportPersonPayload;
/** @deprecated Use BulkImportPersonRowResult */
export type BulkImportTeacherRowResult = BulkImportPersonRowResult;
/** @deprecated Use BulkImportPersonResult */
export type BulkImportTeacherResult = BulkImportPersonResult;

/** @deprecated Use bulkImportPeople */
export const bulkImportTeachers = bulkImportPeople;

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
  target:    "TEACHER" | "SCHOOL";
}

export interface DashboardData {
  rubricSet:       RubricSetInfo;
  schoolGradeSpan: string | null;
  categories:      CategoryEntry[];
  teachers:        Teacher[];
}

/* ── District ────────────────────────────────────────────────── */

export interface DistrictSchoolRow {
  id:               number;
  name:             string;
  region:           string;
  gradeSpan:        string;
  teacherCount:     number;
  observedCount:    number;
  domainAverages:   Record<string, number | null>;
  overall:          number | null;
  lastObservedDate: string | null;
}

export interface DistrictSummaryData {
  rubricSet:  RubricSetInfo;
  categories: CategoryEntry[];
  schools:    DistrictSchoolRow[];
}

export interface SchoolObservationPayload {
  schoolId:     number;
  rubricSetId:  number;
  date:         string;
  strengths?:   string;
  growthAreas?: string;
  scores:       Record<string, number>;
  target:       "SCHOOL";
}

export async function createSchoolObservation(payload: SchoolObservationPayload): Promise<{ id: string }> {
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
  employeeId:     string;
  teacherName:    string;
  department:     string;
  gradeLevel:     string[];
  schoolName:     string | null;
  rescoreDueDate: string | null;
  needsRescore:   boolean;
}

export async function fetchRescoreQueue(schoolId?: number | null): Promise<RescoreQueueItem[]> {
  const qs = schoolId != null ? `?schoolId=${schoolId}` : "";
  return apiFetch<RescoreQueueItem[]>(`/action-center/rescore-queue${qs}`);
}

export interface OverdueTeacher {
  employeeId:   string;
  teacherName:  string;
  subject:      string | null;
  gradeLevel:   string[] | null;
  schoolName:   string | null;
  lastObserved: string | null;
  daysSince:    number | null;
}

export async function fetchOverdueObservations(schoolId?: number | null): Promise<OverdueTeacher[]> {
  const qs = schoolId != null ? `?schoolId=${schoolId}` : "";
  return apiFetch<OverdueTeacher[]>(`/action-center/overdue-observations${qs}`);
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
  id:                  string;
  observedEmployeeId:  string;
  teacherName?:        string;
  rubricSetId:    number;
  rubricSetSlug?: string;
  rubricSetName?: string;
  date:           string;
  time?:          string;
  course?:        string;
  isWalkthrough:  boolean;
  strengths?:     string;
  growthAreas?:   string;
  observer:       string;
  status:         "draft";
  scores:         Record<string, Score>;
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
  id:              number;
  slug:            string;
  name:            string;
  isActive:        boolean;
  isArchived:      boolean;
  gradeSpan:       string | null;
  description:     string | null;
  displayOrder:    number;
  target:          "TEACHER" | "SCHOOL";
  subjectAudience: "STEM" | "HUMANITIES" | "ALL";
}

/** @deprecated Use RubricSetRow */
export type RubricQuarterRow = RubricSetRow;

export async function fetchRubricSets(includeArchived = false): Promise<RubricSetRow[]> {
  const qs = includeArchived ? "?includeArchived=true" : "";
  return apiFetch<RubricSetRow[]>(`/rubric/sets${qs}`);
}

/** @deprecated Use fetchRubricSets */
export const fetchQuarters = fetchRubricSets;

export async function updateRubricSet(slug: string, fields: { name?: string; description?: string; isArchived?: boolean; gradeSpan?: string | null; target?: "TEACHER" | "SCHOOL"; subjectAudience?: "STEM" | "HUMANITIES" | "ALL" }): Promise<RubricSetRow> {
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
