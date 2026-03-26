export type Score = 1 | 2 | 3 | 4;

export interface Observation {
  date: string;
  scores: Record<string, Score>;
}

export interface Teacher {
  id: string;
  name: string;
  department: string;
  gradeLevel: string;
  yearsExperience: number;
  observations: Observation[];
}

export const CATEGORIES = [
  {
    id: "cat1",
    label: "Classroom Culture",
    domains: [
      { id: "confident_presence", label: "Confident Presence" },
      { id: "wtd_cycle", label: "WTD Cycle" },
      { id: "ratio_engagement", label: "Ratio & Engagement" },
      { id: "joy", label: "Joy" },
    ],
  },
  {
    id: "cat2",
    label: "The First 15",
    domains: [
      { id: "f15_entry", label: "F15: Entry/ DN/DNR" },
      { id: "f15_fluency", label: "F15: Fluency/OD" },
      { id: "f15_launch", label: "F15: Launch" },
    ],
  },
  {
    id: "cat3",
    label: "Academic Monitoring",
    domains: [
      { id: "lp_mks", label: "LP & Mks" },
      { id: "annotations", label: "Annotations & Notebook Habits" },
      { id: "academic_mon", label: "Academic Mon. 101" },
    ],
  },
] as const;

export const ALL_DOMAINS = CATEGORIES.flatMap((c) => c.domains);

export const DEPARTMENTS = ["English", "Math", "Science", "History", "PE", "Art", "Music", "Special Ed"] as const;
export const GRADE_LEVELS = ["K–2", "3–5", "6–8", "9–12"] as const;
export const EXP_BUCKETS = ["0–2 yrs", "3–5 yrs", "6–10 yrs", "10+ yrs"] as const;

export function getExpBucket(yrs: number): typeof EXP_BUCKETS[number] {
  if (yrs <= 2) return "0–2 yrs";
  if (yrs <= 5) return "3–5 yrs";
  if (yrs <= 10) return "6–10 yrs";
  return "10+ yrs";
}

function obs(date: string, s: Score[]): Observation {
  const ids = ALL_DOMAINS.map((d) => d.id);
  return { date, scores: Object.fromEntries(ids.map((id, i) => [id, s[i]])) as Record<string, Score> };
}

export const TEACHERS: Teacher[] = [
  { id: "t1",  name: "Sarah Johnson",    department: "English",    gradeLevel: "6–8",  yearsExperience: 4,  observations: [obs("2026-01-10",[2,2,2,3,2,3,2,2,2,3]),obs("2026-02-14",[3,2,3,3,3,3,3,3,2,3]),obs("2026-03-12",[3,3,3,4,3,3,3,3,3,3])] },
  { id: "t2",  name: "Marcus Williams",  department: "Math",       gradeLevel: "9–12", yearsExperience: 1,  observations: [obs("2026-01-15",[1,1,2,1,2,1,2,1,2,1]),obs("2026-02-20",[2,2,2,2,2,2,2,2,2,2]),obs("2026-03-18",[2,2,3,2,2,2,2,2,3,2])] },
  { id: "t3",  name: "Priya Patel",      department: "Science",    gradeLevel: "6–8",  yearsExperience: 11, observations: [obs("2026-01-08",[4,3,4,4,4,3,4,3,4,4]),obs("2026-02-11",[4,4,4,4,4,4,4,4,4,4]),obs("2026-03-10",[4,4,4,4,4,4,4,4,4,4])] },
  { id: "t4",  name: "David Chen",       department: "History",    gradeLevel: "9–12", yearsExperience: 7,  observations: [obs("2026-01-22",[3,3,2,3,3,2,3,3,2,3]),obs("2026-02-25",[3,3,3,3,3,3,3,3,3,3]),obs("2026-03-20",[3,3,3,3,3,3,3,3,3,3])] },
  { id: "t5",  name: "Amanda Torres",    department: "English",    gradeLevel: "3–5",  yearsExperience: 2,  observations: [obs("2026-01-12",[1,2,1,2,1,2,1,1,2,1]),obs("2026-02-16",[2,2,2,2,2,2,2,2,2,2]),obs("2026-03-14",[2,2,2,3,2,2,2,2,2,2])] },
  { id: "t6",  name: "James Mitchell",   department: "Math",       gradeLevel: "6–8",  yearsExperience: 14, observations: [obs("2026-01-18",[4,3,4,3,4,3,4,4,3,4]),obs("2026-02-22",[4,4,4,4,4,4,4,4,4,4]),obs("2026-03-19",[4,4,4,4,4,4,4,4,4,4])] },
  { id: "t7",  name: "Linda Roberts",    department: "Science",    gradeLevel: "3–5",  yearsExperience: 6,  observations: [obs("2026-01-20",[2,3,2,2,3,2,3,2,3,2]),obs("2026-02-18",[3,3,3,3,3,3,3,3,3,3]),obs("2026-03-16",[3,3,3,3,3,3,3,3,3,3])] },
  { id: "t8",  name: "Kevin Nguyen",     department: "PE",         gradeLevel: "K–2",  yearsExperience: 3,  observations: [obs("2026-01-25",[3,2,3,4,2,3,2,2,1,2]),obs("2026-02-28",[3,3,3,4,3,3,3,2,2,2]),obs("2026-03-22",[3,3,3,4,3,3,3,3,2,3])] },
  { id: "t9",  name: "Olivia Brown",     department: "Art",        gradeLevel: "K–2",  yearsExperience: 1,  observations: [obs("2026-01-14",[1,1,1,2,1,1,1,1,1,1]),obs("2026-02-17",[2,1,2,2,2,2,1,2,2,2]),obs("2026-03-15",[2,2,2,3,2,2,2,2,2,2])] },
  { id: "t10", name: "Thomas Garcia",    department: "History",    gradeLevel: "9–12", yearsExperience: 18, observations: [obs("2026-01-28",[4,4,3,4,3,4,3,4,3,4]),obs("2026-02-24",[4,4,4,4,4,4,4,4,3,4]),obs("2026-03-24",[4,4,4,4,4,4,4,4,4,4])] },
  { id: "t11", name: "Rachel Kim",       department: "English",    gradeLevel: "6–8",  yearsExperience: 5,  observations: [obs("2026-01-10",[3,3,2,3,3,2,3,3,2,3]),obs("2026-02-14",[3,3,3,3,3,3,3,3,3,3]),obs("2026-03-12",[3,3,3,4,3,3,3,3,3,3])] },
  { id: "t12", name: "Brian Foster",     department: "Math",       gradeLevel: "3–5",  yearsExperience: 9,  observations: [obs("2026-01-15",[2,2,3,2,2,2,3,2,2,2]),obs("2026-02-20",[3,2,3,2,3,2,3,2,3,2]),obs("2026-03-18",[3,3,3,3,3,3,3,3,3,3])] },
  { id: "t13", name: "Monica Alvarez",   department: "Science",    gradeLevel: "9–12", yearsExperience: 12, observations: [obs("2026-01-08",[4,3,3,4,4,3,4,3,4,4]),obs("2026-02-11",[4,4,4,4,4,4,4,4,4,4]),obs("2026-03-10",[4,4,4,4,4,4,4,4,4,4])] },
  { id: "t14", name: "Derek Thompson",   department: "History",    gradeLevel: "6–8",  yearsExperience: 2,  observations: [obs("2026-01-22",[2,1,2,2,2,2,1,2,1,2]),obs("2026-02-25",[2,2,2,2,2,2,2,2,2,2]),obs("2026-03-20",[2,2,3,2,2,2,2,2,2,2])] },
  { id: "t15", name: "Stephanie Lee",    department: "Music",      gradeLevel: "K–2",  yearsExperience: 8,  observations: [obs("2026-01-12",[3,3,4,4,3,3,4,3,3,3]),obs("2026-02-16",[4,3,4,4,4,3,4,3,3,4]),obs("2026-03-14",[4,4,4,4,4,4,4,4,3,4])] },
  { id: "t16", name: "Carlos Reyes",     department: "PE",         gradeLevel: "9–12", yearsExperience: 15, observations: [obs("2026-01-18",[3,3,3,4,3,3,3,3,2,3]),obs("2026-02-22",[3,3,4,4,3,3,3,3,3,3]),obs("2026-03-19",[4,3,4,4,4,3,4,3,3,4])] },
  { id: "t17", name: "Nicole Harris",    department: "Special Ed", gradeLevel: "3–5",  yearsExperience: 3,  observations: [obs("2026-01-20",[2,2,2,2,2,2,2,2,2,2]),obs("2026-02-18",[2,2,3,2,2,2,2,2,3,2]),obs("2026-03-16",[3,2,3,3,3,2,3,2,3,3])] },
  { id: "t18", name: "Paul Wright",      department: "Math",       gradeLevel: "9–12", yearsExperience: 20, observations: [obs("2026-01-25",[4,4,4,3,4,4,4,4,3,4]),obs("2026-02-28",[4,4,4,4,4,4,4,4,4,4]),obs("2026-03-22",[4,4,4,4,4,4,4,4,4,4])] },
  { id: "t19", name: "Julia Morgan",     department: "English",    gradeLevel: "K–2",  yearsExperience: 1,  observations: [obs("2026-01-14",[1,1,2,2,1,2,1,1,2,1]),obs("2026-02-17",[2,2,2,2,2,2,2,2,2,2]),obs("2026-03-15",[2,2,2,3,2,2,2,2,2,2])] },
  { id: "t20", name: "Anthony Clark",    department: "Art",        gradeLevel: "6–8",  yearsExperience: 4,  observations: [obs("2026-01-28",[3,2,3,4,3,2,3,2,3,3]),obs("2026-02-24",[3,3,3,4,3,3,3,3,3,3]),obs("2026-03-24",[3,3,3,4,3,3,3,3,3,3])] },
];

export function getMostRecentObservation(teacher: Teacher): Observation {
  return teacher.observations.reduce((latest, obs) =>
    obs.date > latest.date ? obs : latest
  );
}

export function getTeacherAverage(teacher: Teacher): number {
  const recent = getMostRecentObservation(teacher);
  const scores = Object.values(recent.scores) as Score[];
  return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}

export function getDomainAverage(domainId: string, teachers: Teacher[]): number {
  const scores = teachers.map((t) => {
    const recent = getMostRecentObservation(t);
    return (recent.scores[domainId] ?? 0) as number;
  });
  return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}
