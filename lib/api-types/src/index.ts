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
  status:  "created" | "skipped" | "error";
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
  id:        number;
  name:      string;
  region?:   string;
  gradeSpan?: string;
}

/** Full admin school record with explicit nullability. */
export interface AdminSchool {
  id:        number;
  name:      string;
  region:    string | null;
  gradeSpan: string | null;
}

export interface SchoolPayload {
  name:       string;
  region?:    string | null;
  gradeSpan?: string | null;
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
  id:           string;
  date:         string;
  time?:        string;
  course?:      string;
  scores:       Record<string, Score>;
  strengths?:   string;
  growthAreas?: string;
  observer:     string;
  isWalkthrough?: boolean;
  editedBy?:    string;
  editedAt?:    string;
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

/* ── District ────────────────────────────────────────────────────── */

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

/* ── Observation payloads ────────────────────────────────────────── */

export interface SchoolObservationPayload {
  schoolId:     number;
  rubricSetId:  number;
  date:         string;
  strengths?:   string;
  growthAreas?: string;
  scores:       Record<string, number>;
  target:       "SCHOOL";
}

export interface CreateObservationPayload {
  teacherId:      string;
  rubricSetId:    number;
  date:           string;
  time?:          string;
  course?:        string;
  strengths?:     string;
  growthAreas?:   string;
  observer?:      string;
  observerId?:    number;
  isWalkthrough?: boolean;
  scores?:        Record<string, Score>;
  status?:        "draft" | "published";
}

export interface UpdateObservationPayload {
  date?:        string;
  strengths?:   string;
  growthAreas?: string;
  observer?:    string;
  scores?:      Record<string, Score>;
  status?:      "draft" | "published";
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
  observer:           string;
  status:             "draft";
  scores:             Record<string, Score>;
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
