export type Score = 1 | 2 | 3 | 4;

export interface Observation {
  date: string;
  scores: Record<string, Score>;
}

export interface Teacher {
  id: string;
  name: string;
  department: string;
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
      { id: "f15_entry", label: "F15: Entry/DN/DNR" },
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

export const TEACHERS: Teacher[] = [
  {
    id: "t1",
    name: "Sarah Johnson",
    department: "English",
    observations: [
      {
        date: "2026-01-10",
        scores: { confident_presence: 2, wtd_cycle: 2, ratio_engagement: 2, joy: 3, f15_entry: 2, f15_fluency: 3, f15_launch: 2, lp_mks: 2, annotations: 2, academic_mon: 3 },
      },
      {
        date: "2026-02-14",
        scores: { confident_presence: 3, wtd_cycle: 2, ratio_engagement: 3, joy: 3, f15_entry: 3, f15_fluency: 3, f15_launch: 3, lp_mks: 3, annotations: 2, academic_mon: 3 },
      },
      {
        date: "2026-03-12",
        scores: { confident_presence: 3, wtd_cycle: 3, ratio_engagement: 3, joy: 4, f15_entry: 3, f15_fluency: 3, f15_launch: 3, lp_mks: 3, annotations: 3, academic_mon: 3 },
      },
    ],
  },
  {
    id: "t2",
    name: "Marcus Williams",
    department: "Math",
    observations: [
      {
        date: "2026-01-15",
        scores: { confident_presence: 1, wtd_cycle: 1, ratio_engagement: 2, joy: 1, f15_entry: 2, f15_fluency: 1, f15_launch: 2, lp_mks: 1, annotations: 2, academic_mon: 1 },
      },
      {
        date: "2026-02-20",
        scores: { confident_presence: 2, wtd_cycle: 2, ratio_engagement: 2, joy: 2, f15_entry: 2, f15_fluency: 2, f15_launch: 2, lp_mks: 2, annotations: 2, academic_mon: 2 },
      },
      {
        date: "2026-03-18",
        scores: { confident_presence: 2, wtd_cycle: 2, ratio_engagement: 3, joy: 2, f15_entry: 2, f15_fluency: 2, f15_launch: 2, lp_mks: 2, annotations: 3, academic_mon: 2 },
      },
    ],
  },
  {
    id: "t3",
    name: "Priya Patel",
    department: "Science",
    observations: [
      {
        date: "2026-01-08",
        scores: { confident_presence: 4, wtd_cycle: 3, ratio_engagement: 4, joy: 4, f15_entry: 4, f15_fluency: 3, f15_launch: 4, lp_mks: 3, annotations: 4, academic_mon: 4 },
      },
      {
        date: "2026-02-11",
        scores: { confident_presence: 4, wtd_cycle: 4, ratio_engagement: 4, joy: 4, f15_entry: 4, f15_fluency: 4, f15_launch: 4, lp_mks: 4, annotations: 4, academic_mon: 4 },
      },
      {
        date: "2026-03-10",
        scores: { confident_presence: 4, wtd_cycle: 4, ratio_engagement: 4, joy: 4, f15_entry: 4, f15_fluency: 4, f15_launch: 4, lp_mks: 4, annotations: 4, academic_mon: 4 },
      },
    ],
  },
  {
    id: "t4",
    name: "David Chen",
    department: "History",
    observations: [
      {
        date: "2026-01-22",
        scores: { confident_presence: 3, wtd_cycle: 3, ratio_engagement: 2, joy: 3, f15_entry: 3, f15_fluency: 2, f15_launch: 3, lp_mks: 3, annotations: 2, academic_mon: 3 },
      },
      {
        date: "2026-02-25",
        scores: { confident_presence: 3, wtd_cycle: 3, ratio_engagement: 3, joy: 3, f15_entry: 3, f15_fluency: 3, f15_launch: 3, lp_mks: 3, annotations: 3, academic_mon: 3 },
      },
      {
        date: "2026-03-20",
        scores: { confident_presence: 3, wtd_cycle: 3, ratio_engagement: 3, joy: 3, f15_entry: 3, f15_fluency: 3, f15_launch: 3, lp_mks: 3, annotations: 3, academic_mon: 3 },
      },
    ],
  },
  {
    id: "t5",
    name: "Amanda Torres",
    department: "English",
    observations: [
      {
        date: "2026-01-12",
        scores: { confident_presence: 1, wtd_cycle: 2, ratio_engagement: 1, joy: 2, f15_entry: 1, f15_fluency: 2, f15_launch: 1, lp_mks: 1, annotations: 2, academic_mon: 1 },
      },
      {
        date: "2026-02-16",
        scores: { confident_presence: 2, wtd_cycle: 2, ratio_engagement: 2, joy: 2, f15_entry: 2, f15_fluency: 2, f15_launch: 2, lp_mks: 2, annotations: 2, academic_mon: 2 },
      },
      {
        date: "2026-03-14",
        scores: { confident_presence: 2, wtd_cycle: 2, ratio_engagement: 2, joy: 3, f15_entry: 2, f15_fluency: 2, f15_launch: 2, lp_mks: 2, annotations: 2, academic_mon: 2 },
      },
    ],
  },
  {
    id: "t6",
    name: "James Mitchell",
    department: "Math",
    observations: [
      {
        date: "2026-01-18",
        scores: { confident_presence: 4, wtd_cycle: 3, ratio_engagement: 4, joy: 3, f15_entry: 4, f15_fluency: 3, f15_launch: 4, lp_mks: 4, annotations: 3, academic_mon: 4 },
      },
      {
        date: "2026-02-22",
        scores: { confident_presence: 4, wtd_cycle: 4, ratio_engagement: 4, joy: 4, f15_entry: 4, f15_fluency: 4, f15_launch: 4, lp_mks: 4, annotations: 4, academic_mon: 4 },
      },
      {
        date: "2026-03-19",
        scores: { confident_presence: 4, wtd_cycle: 4, ratio_engagement: 4, joy: 4, f15_entry: 4, f15_fluency: 4, f15_launch: 4, lp_mks: 4, annotations: 4, academic_mon: 4 },
      },
    ],
  },
  {
    id: "t7",
    name: "Linda Roberts",
    department: "Science",
    observations: [
      {
        date: "2026-01-20",
        scores: { confident_presence: 2, wtd_cycle: 3, ratio_engagement: 2, joy: 2, f15_entry: 3, f15_fluency: 2, f15_launch: 3, lp_mks: 2, annotations: 3, academic_mon: 2 },
      },
      {
        date: "2026-02-18",
        scores: { confident_presence: 3, wtd_cycle: 3, ratio_engagement: 3, joy: 3, f15_entry: 3, f15_fluency: 3, f15_launch: 3, lp_mks: 3, annotations: 3, academic_mon: 3 },
      },
      {
        date: "2026-03-16",
        scores: { confident_presence: 3, wtd_cycle: 3, ratio_engagement: 3, joy: 3, f15_entry: 3, f15_fluency: 3, f15_launch: 3, lp_mks: 3, annotations: 3, academic_mon: 3 },
      },
    ],
  },
  {
    id: "t8",
    name: "Kevin Nguyen",
    department: "PE",
    observations: [
      {
        date: "2026-01-25",
        scores: { confident_presence: 3, wtd_cycle: 2, ratio_engagement: 3, joy: 4, f15_entry: 2, f15_fluency: 3, f15_launch: 2, lp_mks: 2, annotations: 1, academic_mon: 2 },
      },
      {
        date: "2026-02-28",
        scores: { confident_presence: 3, wtd_cycle: 3, ratio_engagement: 3, joy: 4, f15_entry: 3, f15_fluency: 3, f15_launch: 3, lp_mks: 2, annotations: 2, academic_mon: 2 },
      },
      {
        date: "2026-03-22",
        scores: { confident_presence: 3, wtd_cycle: 3, ratio_engagement: 3, joy: 4, f15_entry: 3, f15_fluency: 3, f15_launch: 3, lp_mks: 3, annotations: 2, academic_mon: 3 },
      },
    ],
  },
  {
    id: "t9",
    name: "Olivia Brown",
    department: "Art",
    observations: [
      {
        date: "2026-01-14",
        scores: { confident_presence: 1, wtd_cycle: 1, ratio_engagement: 1, joy: 2, f15_entry: 1, f15_fluency: 1, f15_launch: 1, lp_mks: 1, annotations: 1, academic_mon: 1 },
      },
      {
        date: "2026-02-17",
        scores: { confident_presence: 2, wtd_cycle: 1, ratio_engagement: 2, joy: 2, f15_entry: 2, f15_fluency: 2, f15_launch: 1, lp_mks: 2, annotations: 2, academic_mon: 2 },
      },
      {
        date: "2026-03-15",
        scores: { confident_presence: 2, wtd_cycle: 2, ratio_engagement: 2, joy: 3, f15_entry: 2, f15_fluency: 2, f15_launch: 2, lp_mks: 2, annotations: 2, academic_mon: 2 },
      },
    ],
  },
  {
    id: "t10",
    name: "Thomas Garcia",
    department: "History",
    observations: [
      {
        date: "2026-01-28",
        scores: { confident_presence: 4, wtd_cycle: 4, ratio_engagement: 3, joy: 4, f15_entry: 3, f15_fluency: 4, f15_launch: 3, lp_mks: 4, annotations: 3, academic_mon: 4 },
      },
      {
        date: "2026-02-24",
        scores: { confident_presence: 4, wtd_cycle: 4, ratio_engagement: 4, joy: 4, f15_entry: 4, f15_fluency: 4, f15_launch: 4, lp_mks: 4, annotations: 3, academic_mon: 4 },
      },
      {
        date: "2026-03-24",
        scores: { confident_presence: 4, wtd_cycle: 4, ratio_engagement: 4, joy: 4, f15_entry: 4, f15_fluency: 4, f15_launch: 4, lp_mks: 4, annotations: 4, academic_mon: 4 },
      },
    ],
  },
];

export function getMostRecentObservation(teacher: Teacher): Observation {
  return teacher.observations.reduce((latest, obs) =>
    obs.date > latest.date ? obs : latest
  );
}

export function getTeacherAverage(teacher: Teacher): number {
  const obs = getMostRecentObservation(teacher);
  const scores = Object.values(obs.scores) as Score[];
  return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}

export function getDomainAverage(domainId: string): number {
  const scores = TEACHERS.map((t) => {
    const obs = getMostRecentObservation(t);
    return (obs.scores[domainId] ?? 0) as number;
  });
  return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}
