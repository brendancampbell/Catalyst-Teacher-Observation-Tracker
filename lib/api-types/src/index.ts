export * from "./grade-levels";
export * from "./subject-audience";
export * from "./system-settings";
export * from "./observation-payload";

/**
 * Maximum non-archived rubric sets allowed IN ONE SCHOOL YEAR.
 *
 * Shared, because it has been duplicated twice and disagreed with itself both
 * times. The server counted across all years while the screen listed only the
 * active one, so creation failed at what looked like five of six. Then the
 * server limit was raised to 15 and the admin page kept its own hardcoded 6,
 * so the button stayed disabled.
 *
 * One number, imported by everything that enforces or displays it.
 *
 * Archived sets do not count, so archiving one always frees a slot.
 */
export const MAX_ACTIVE_RUBRIC_SETS = 15;

/* ── Primitive types ────────────────────────────────────────────── */

export type Score = 0 | 0.5 | 1;

/* ── Roles ──────────────────────────────────────────────────────── */

export type UserRole   = "COACH" | "SCHOOL_LEADER" | "NETWORK_LEADER" | "NETWORK_ADMIN";
export type PersonRole = "COACH" | "SCHOOL_LEADER" | "NETWORK_LEADER" | "NETWORK_ADMIN" | "NO_ACCESS";

/* ── Users / People ─────────────────────────────────────────────── */

export interface User {
  id:          string;
  name:        string;
  email:       string;
  role:        UserRole;
  schoolId:    number | null;
  schoolName?: string | null;
}

export interface PersonRow {
  employeeId:               string;
  email:                    string;
  firstName:                string;
  lastName:                 string;
  name:                     string;
  role:                     PersonRole;
  schoolId:                 number | null;
  schoolName:               string | null;
  /** True when schoolId is non-null but the school row no longer exists in the DB. */
  schoolOrphaned?:          boolean;
  isActive:                 boolean;
  includeInFeedbackTracker: boolean;
  department:               string | null;
  gradeLevel:               string[];
}

export interface BulkImportPersonPayload {
  firstName:                string;
  lastName:                 string;
  employeeId:               string;
  email:                    string;
  role:                     string;
  department:               string;
  gradeLevel:               string;
  school:                   string;
  includeInFeedbackTracker?: string;
}

export interface BulkImportPersonRowResult {
  row:     number;
  status:  "created" | "assigned" | "skipped" | "error";
  name?:   string;
  email?:  string;
  reason?: string;
}

export interface BulkImportPersonResult {
  results: BulkImportPersonRowResult[];
}

/* ── Schools ─────────────────────────────────────────────────────── */

export const REGIONS = ["Boston", "Camden", "NYC", "Newark", "Rochester"] as const;
export type Region = typeof REGIONS[number];

export const GRADE_SPANS = ["ES", "MS", "HS"] as const;
export type GradeSpan = typeof GRADE_SPANS[number];

/** Simple school record (used by the mobile app). */
export interface School {
  id:            number;
  displayName:   string;
  fullName?:     string | null;
  abbreviation?: string | null;
  region?:       string;
  gradeSpan?:    string;
  isHomeOffice?: boolean;
}

/** Full admin school record with explicit nullability. */
export interface AdminSchool {
  id:           number;
  displayName:  string;
  fullName:     string | null;
  abbreviation: string | null;
  region:       string | null;
  gradeSpan:    string | null;
  isHomeOffice: boolean;
}

export interface SchoolPayload {
  displayName:   string;
  fullName?:     string | null;
  abbreviation?: string | null;
  region?:       string | null;
  gradeSpan?:    string | null;
}

/* ── Rubric sets ─────────────────────────────────────────────────── */

/** Minimal rubric set info included in dashboard/district responses. */
export interface RubricSetInfo {
  id:        number;
  slug:      string;
  name:      string;
  gradeSpan: string | null;
  target:    "TEACHER" | "SCHOOL";
}

/** Full rubric set record (used in admin pages). */
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

/** Lightweight rubric set (used by the mobile app for the picker). */
export interface RubricSet {
  id:              number;
  slug:            string;
  name:            string;
  isArchived?:     boolean;
  displayOrder?:   number;
  target?:         "TEACHER" | "SCHOOL";
  subjectAudience?: "STEM" | "HUMANITIES" | "ALL";
}

/* ── Rubric structure ────────────────────────────────────────────── */

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

/** Domain entry as returned in dashboard/district summary category trees. */
export interface DomainEntry {
  id:           string;
  label:        string;
  description?: string;
}

/** Category entry as returned in dashboard/district summary responses. */
export interface CategoryEntry {
  id:      string;
  label:   string;
  domains: DomainEntry[];
}

/** Rubric domain as returned by the mobile rubric endpoint. */
export interface RubricDomain {
  id:           string;
  slug:         string;
  name:         string;
  description?: string;
  displayOrder: number;
}

/** Rubric category as returned by the mobile rubric endpoint. */
export interface RubricCategory {
  id:           string;
  name:         string;
  displayOrder: number;
  domains:      RubricDomain[];
}

/* ── Teachers & Observations ────────────────────────────────────── */

/** A single observation record as returned by API responses. */
export interface Observation {
  id:                  string;
  date:                string;
  time?:               string;
  course?:             string;
  scores:              Record<string, Score>;
  strengths?:          string;
  growthAreas?:        string;
  observer:            string;
  observerEmployeeId?: string | null;
  observerEmail?:      string | null;
  isWalkthrough?:      boolean;
  editedBy?:           string;
  editedAt?:           string;
}

/**
 * Full teacher record including historical observations.
 * Returned by the /dashboard endpoint.
 */
export interface Teacher {
  id:             string;
  name:           string;
  firstName:      string;
  lastName:       string;
  employeeId?:    string | null;
  email?:         string | null;
  subject?:       string | null;
  gradeLevel:     string[];
  observations:   Observation[];
  needsRescore?:  boolean;
  rescoreDueDate?: string | null;
}

/**
 * Lightweight teacher/person row (no observations).
 * Used by the mobile app when listing people from /api/people.
 */
export interface TeacherRow {
  id:                       string;
  name:                     string;
  department:               string | null;
  gradeLevel:               string[];
  isActive:                 boolean;
  schoolId:                 number | null;
  schoolName?:              string | null;
  includeInFeedbackTracker: boolean;
}

/* ── Dashboard ───────────────────────────────────────────────────── */

export interface DashboardData {
  rubricSet:       RubricSetInfo;
  schoolGradeSpan: string | null;
  categories:      CategoryEntry[];
  teachers:        Teacher[];
}

export interface SchoolObservationHistory {
  school: {
    id:           number;
    name:         string;
    abbreviation: string | null;
    gradeSpan:    string | null;
    region:       string | null;
  };
  rubricSet:    RubricSetInfo;
  categories:   CategoryEntry[];
  /* Newest first. School-wide observations have no teacher attached, which is
     why they cannot appear on any teacher's page and need one of their own. */
  observations: Observation[];
}

/* ── District ────────────────────────────────────────────────────── */

export interface DistrictSchoolRow {
  id:               number;
  name:             string;
  abbreviation:     string | null;
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

/* ── Observation payloads ────────────────────────────────────────── */

export interface SchoolObservationPayload {
  schoolId:     number;
  rubricSetId:  number;
  date:         string;
  strengths?:   string;
  growthAreas?: string;
  scores:       Record<string, number>;
  target:       "SCHOOL";
  /* A label on the observation, and only that. Walkthroughs on a TEACHER
     rubric drive the rescore queue, but that queue flags a person and a
     school-wide observation has none — see the SCHOOL insert in
     routes/observations.ts. Nothing here flags a school for rescoring. */
  isWalkthrough?: boolean;
}

export interface CreateObservationPayload {
  teacherId:           string;
  rubricSetId:         number;
  date:                string;
  time?:               string;
  course?:             string;
  strengths?:          string;
  growthAreas?:        string;
  observer?:           string;
  observerId?:         number;
  isWalkthrough?:      boolean;
  scores?:             Record<string, Score>;
  status?:             "draft" | "published";
  newActionStep?:      { text: string; dueDate: string };
  masterActionStepId?: number;
  /* Push an existing open step's due date back instead of assigning a new
     one. The two are mutually exclusive — the server rejects both together. */
  extendActionStep?:   { actionStepId: number; newDueDate: string; note?: string };
}

export interface UpdateObservationPayload {
  date?:               string;
  /* Null clears it. The facts of an observation are correctable after the
     event; observedEmployeeId only within the observation's own school, which
     the server enforces. */
  time?:               string | null;
  course?:             string | null;
  observedEmployeeId?: string;
  strengths?:          string;
  growthAreas?:        string;
  observer?:           string;
  scores?:             Record<string, Score>;
  status?:             "draft" | "published";
  isWalkthrough?:      boolean;
  newActionStep?:      { text: string; dueDate: string };
  masterActionStepId?: number;
  /* Push an existing open step's due date back instead of assigning a new
     one. The two are mutually exclusive — the server rejects both together. */
  extendActionStep?:   { actionStepId: number; newDueDate: string; note?: string };
}

export interface DraftObservation {
  id:                 string;
  observedEmployeeId: string;
  teacherName?:       string;
  rubricSetId:        number;
  rubricSetSlug?:     string;
  rubricSetName?:     string;
  date:               string;
  time?:              string;
  course?:            string;
  isWalkthrough:      boolean;
  strengths?:         string;
  growthAreas?:       string;
  actionStepText?:    string;
  actionStepDueDate?: string;
  observer:           string;
  status:             "draft";
  scores:             Record<string, Score>;
}

/* ── Action Steps ────────────────────────────────────────────────── */

export interface ActionStep {
  id:                          number;
  teacherEmployeeId:           string;
  assignedByEmployeeId?:       string;
  assignedByName?:             string;
  assignedDuringObservationId?: string;
  text:                        string;
  dueDate:                     string;
  status:                      "open" | "mastered";
  masteredAt?:                 string;
  masteredByEmployeeId?:       string;
  masteredByName?:             string;
  masteredDuringObservationId?: string;
  createdAt:                   string;
  /* How many times the due date has been pushed back, and what it was
     originally due. 0 and the current date for a step never extended. */
  extensionCount?:             number;
  originalDueDate?:            string;
}

export interface OverdueActionStep {
  id:                   number;
  teacherEmployeeId:    string;
  teacherName:          string;
  schoolName?:          string;
  text:                 string;
  dueDate:              string;
  daysOverdue:          number;
  assignedByEmployeeId?: string;
  assignerName?:        string;
  /* Overdue after two extensions is a different situation from overdue for
     the first time. */
  extensionCount?:      number;
  originalDueDate?:     string;
}

/* ── Action Center ───────────────────────────────────────────────── */

export interface RescoreQueueItem {
  employeeId:     string;
  teacherName:    string;
  department:     string;
  gradeLevel:     string[];
  schoolName:     string | null;
  rescoreDueDate: string | null;
  needsRescore:   boolean;
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

export interface NetworkAveragesData {
  domainAverages: Record<string, number | null>;
}

/* ── AI ──────────────────────────────────────────────────────────── */

export interface AIChatResponse {
  reply: string;
}

export interface AIChatSession {
  id:        number;
  title:     string;
  createdAt: string;
  updatedAt: string;
}

export interface InstantAnalysisStructured {
  contextLine:            string;
  summary:                string;
  findings: Array<{
    type:   "pattern" | "leverage" | "flag";
    lead:   string;
    detail: string;
  }>;
  chips:                  [string, string, string];
  narrativeForContext:    string;
  overdueActionStepCount: number;
}

export interface AIChatMessage {
  id:               number;
  sessionId:        number;
  role:             "user" | "assistant";
  content:          string;
  rubricSetSlug?:   string | null;
  instantAnalysis?: InstantAnalysisStructured | null;
  createdAt:        string;
}

export interface AIInsightsResponse {
  topStrength: { domain: string; avg: number; count: number } | null;
  topGrowth:   { domain: string; avg: number; count: number } | null;
}

export interface AICalibrationFlag {
  teacher?:     string;
  school?:      string;
  domain:       string;
  schoolScore:  number;
  networkScore: number;
  delta:        number;
}

/* ── Qualitative Themes ─────────────────────────────────────────── */

export interface QualitativeTheme {
  theme:            string;
  teacherCount:     number;
  observationCount: number;
  teacherIds:       string[];
  teacherNames:     string[];
  observationIds:   number[];
}

export interface QualitativeThemesResult {
  schoolName: string;
  recurringGlows: QualitativeTheme[];
  recurringGrows: QualitativeTheme[];
  actionStepFollowThrough: {
    open:                  number;
    overdue:               number;
    resolved:              number;
    growsWithNoActionStep: string[];
  };
}

export interface QualitativeThemesCacheResponse {
  cache: {
    result:               QualitativeThemesResult;
    generatedAt:          string;
    obsCountAtGeneration: number;
  } | null;
  currentObsCount: number;
}

/* ── School Years ────────────────────────────────────────────────── */

export interface SchoolYearRow {
  id:           number;
  name:         string;
  status:       "active" | "inactive";
  displayOrder: number;
}

export interface SchoolYearActivationPreview {
  openDrafts:            number;
  unresolvedActionSteps: number;
  rescoreQueueItems:     number;
  schoolsAffected:       number;
  activeYearName:        string | null;
  activeYearId:          number | null;
}

/* ── AI Quota Grants ─────────────────────────────────────────────── */

export type AIQuotaGrantType = "chat" | "generation" | "all";

export interface AIQuotaGrant {
  id:                  number;
  employeeId:          string;
  grantType:           AIQuotaGrantType;
  extraRequests:       number;
  usedRequests:        number;
  expiresAt:           string;
  grantedByEmployeeId: string | null;
  note:                string | null;
  createdAt:           string;
}

export interface AIQuotaGrantWithPerson extends AIQuotaGrant {
  personFirstName: string | null;
  personLastName:  string | null;
  personEmail:     string | null;
}

/* ── Usage ───────────────────────────────────────────────────────── */

export interface UsageRow {
  employeeId:   string;
  name:         string;
  role:         string;
  schoolId:     number | null;
  schoolName:   string | null;
  /** Most recent day they used Catalyst, or null if never. Date, not time. */
  lastUsed:     string | null;
  /** Days with any activity this school year — not sign-ins. */
  daysUsed:     number;
  /** Published observations they recorded this school year. Drafts excluded. */
  observations: number;
  /** Action steps assigned this year, including extensions to existing ones. */
  actionSteps:  number;
}

export interface UsageReport {
  schoolYear:     string | null;
  /** Activity was not recorded before this date, so earlier days are absent. */
  recordingSince: string;
  rows:           UsageRow[];
}
