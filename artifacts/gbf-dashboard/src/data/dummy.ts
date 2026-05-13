export type Score = 0 | 0.5 | 1;

export interface Observation {
  id: string;
  date: string;
  time?: string;
  course?: string;
  scores: Record<string, Score>;
  strengths?: string;
  growthAreas?: string;
  observer: string;
  isWalkthrough?: boolean;
  editedBy?: string;
  editedAt?: string;
}

export interface Teacher {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  employeeId?: string | null;
  email?: string | null;
  subject: string;
  gradeLevel: string[];
  observations: Observation[];
  needsRescore?: boolean;
  rescoreDueDate?: string | null;
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

export type DomainEntry = { readonly id: string; readonly label: string };
export const ALL_DOMAINS: DomainEntry[] = CATEGORIES.flatMap((c) => c.domains as unknown as DomainEntry[]);

export const SUBJECTS = ["English", "Math", "Science", "History", "PE", "Art", "Music", "Special Ed"] as const;
export const GRADE_LEVELS = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"] as const;

let _obsId = 0;

function remapLegacyScore(v: number): Score {
  if (v <= 1) return 0;
  if (v <= 2) return 0.5;
  return 1;
}

function obs(
  date: string,
  s: number[],
  strengths?: string,
  growthAreas?: string,
  observer = "Principal Rivera",
): Observation {
  const ids = ALL_DOMAINS.map((d) => d.id);
  return {
    id: `obs_${++_obsId}`,
    date,
    scores: Object.fromEntries(ids.map((id, i) => [id, remapLegacyScore(s[i])])) as Record<string, Score>,
    strengths,
    growthAreas,
    observer,
  };
}

export const TEACHERS: Teacher[] = [
  { id: "t1",  name: "Sarah Johnson",    firstName: "Sarah",    lastName: "Johnson",    subject: "English",    gradeLevel: ["6"],           observations: [
    obs("2026-01-10",[2,2,2,3,2,3,2,2,2,3], "Strong rapport with students; consistent routines.", "Needs to increase student talk ratio and cold-calling.", "VP Okafor"),
    obs("2026-02-14",[3,2,3,3,3,3,3,3,2,3], "WTD cycle improving; students respond well to joy moments.", "Annotations still inconsistent — push for 100% compliance.", "Coach Mills"),
    obs("2026-03-12",[3,3,3,4,3,3,3,3,3,3], "Joy and engagement at high levels; culture feels warm and rigorous.", "Continue strengthening WTD cycle with faster pacing."),
  ]},
  { id: "t2",  name: "Marcus Williams",  firstName: "Marcus",   lastName: "Williams",   subject: "Math",       gradeLevel: ["9","10"],      observations: [
    obs("2026-01-15",[1,1,2,1,2,1,2,1,2,1], "Shows genuine care for students.", "Routines are unclear; voice projection needs work. Needs immediate coaching on entry and WTD.", "Coach Mills"),
    obs("2026-02-20",[2,2,2,2,2,2,2,2,2,2], "Entry routine improving. Students beginning to follow expectations.", "WTD cycle still reactive. Work on proactive monitoring and narrating positives.", "VP Okafor"),
    obs("2026-03-18",[2,2,3,2,2,2,2,2,3,2], "Engagement picking up in the middle of the lesson. Annotations notebook habit is a bright spot.", "Confident presence still inconsistent. Practice stand and scan."),
  ]},
  { id: "t3",  name: "Priya Patel",      firstName: "Priya",    lastName: "Patel",      subject: "Science",    gradeLevel: ["7"],           observations: [
    obs("2026-01-08",[4,3,4,4,4,3,4,3,4,4], "Exceptional engagement; students deeply invested in content.", "F15 Fluency pacing can occasionally feel rushed.", "VP Okafor"),
    obs("2026-02-11",[4,4,4,4,4,4,4,4,4,4], "Model classroom — every domain at exemplary. Great job.", "Nothing critical; share best practices with peers.", "Coach Mills"),
    obs("2026-03-10",[4,4,4,4,4,4,4,4,4,4], "Consistent excellence across all domains. Peer coaching candidate.", "Consider leading a professional development session on ratio."),
  ]},
  { id: "t4",  name: "David Chen",       firstName: "David",    lastName: "Chen",       subject: "History",    gradeLevel: ["10"],          observations: [
    obs("2026-01-22",[3,3,2,3,3,2,3,3,2,3], "Knows his content deeply; students trust him.", "Ratio and engagement need more structured student talk protocols.", "Coach Mills"),
    obs("2026-02-25",[3,3,3,3,3,3,3,3,3,3], "Consistent across all domains. Great improvement in F15 Fluency.", "Push toward 4s in ratio — try debate or structured partner work.", "VP Okafor"),
    obs("2026-03-20",[3,3,3,3,3,3,3,3,3,3], "Solid and reliable. Culture is positive and purposeful.", "Ready for a stretch goal: aim for one exemplary domain this cycle."),
  ]},
  { id: "t5",  name: "Amanda Torres",    firstName: "Amanda",   lastName: "Torres",     subject: "English",    gradeLevel: ["5"],           observations: [
    obs("2026-01-12",[1,2,1,2,1,2,1,1,2,1], "Students like her; energy is positive.", "Routines and systems need significant tightening. Entry and presence are the priority.", "VP Okafor"),
    obs("2026-02-16",[2,2,2,2,2,2,2,2,2,2], "Entry routine much improved after coaching. Students know expectations now.", "All domains hovering at 2 — need a targeted plan to build one to a 3.", "Coach Mills"),
    obs("2026-03-14",[2,2,2,3,2,2,2,2,2,2], "Joy was a genuine 3 today — class celebration was on point!", "Hold the joy standard and replicate those conditions across other domains."),
  ]},
  { id: "t6",  name: "James Mitchell",   firstName: "James",    lastName: "Mitchell",   subject: "Math",       gradeLevel: ["6","7"],       observations: [
    obs("2026-01-18",[4,3,4,3,4,3,4,4,3,4], "Veteran presence; students know exactly what to do.", "WTD and F15 Fluency still at 3 — the gap between domains is interesting.", "Coach Mills"),
    obs("2026-02-22",[4,4,4,4,4,4,4,4,4,4], "Every domain exemplary. WTD cycle was particularly sharp.", "Nothing to correct. Document this lesson for future PD use.", "VP Okafor"),
    obs("2026-03-19",[4,4,4,4,4,4,4,4,4,4], "Excellent leadership presence. Serves as informal mentor for new teachers.", "Continue mentoring. Explore instructional leadership opportunities."),
  ]},
  { id: "t7",  name: "Linda Roberts",    firstName: "Linda",    lastName: "Roberts",    subject: "Science",    gradeLevel: ["4"],           observations: [
    obs("2026-01-20",[2,3,2,2,3,2,3,2,3,2], "Great F15 entry and launch — clear strengths.", "Confident presence and ratio need development. Practice assertive voice.", "VP Okafor"),
    obs("2026-02-18",[3,3,3,3,3,3,3,3,3,3], "All domains at proficient — nice jump from January. Momentum is real.", "Sustain and deepen. Target one area to push toward exemplary next cycle.", "Coach Mills"),
    obs("2026-03-16",[3,3,3,3,3,3,3,3,3,3], "Consistent and reliable. Classroom culture feels safe and focused.", "Challenge herself to differentiate instruction more intentionally."),
  ]},
  { id: "t8",  name: "Kevin Nguyen",     firstName: "Kevin",    lastName: "Nguyen",     subject: "PE",         gradeLevel: ["K","1","2"],   observations: [
    obs("2026-01-25",[3,2,3,4,2,3,2,2,1,2], "Joy is a genuine strength — kids love PE with him.", "Annotations and academic monitoring feel underutilized in a PE context. Adapt the frameworks.", "Coach Mills"),
    obs("2026-02-28",[3,3,3,4,3,3,3,2,2,2], "WTD cycle and F15 much improved. Joy remains excellent.", "Annotations still a 2. Consider a PE-specific notebook protocol.", "VP Okafor"),
    obs("2026-03-22",[3,3,3,4,3,3,3,3,2,3], "Strong showing across the board. Confident presence continues to grow.", "Push annotations to 3 — the PE adaptation is promising, keep going."),
  ]},
  { id: "t9",  name: "Olivia Brown",     firstName: "Olivia",   lastName: "Brown",      subject: "Art",        gradeLevel: ["K","1","2"],   observations: [
    obs("2026-01-14",[1,1,1,2,1,1,1,1,1,1], "Creative spirit; genuine love of art visible.", "Classroom management is the primary barrier. Needs intensive coaching on routines and presence.", "VP Okafor"),
    obs("2026-02-17",[2,1,2,2,2,2,1,2,2,2], "Entry improved after check-in. Joy up slightly.", "WTD cycle and F15 Launch are still 1s — focus coaching here for March.", "Coach Mills"),
    obs("2026-03-15",[2,2,2,3,2,2,2,2,2,2], "Joy was a real 3 today — creative celebration worked well!", "Keep building on joy. Bridge that energy into structure and ratio."),
  ]},
  { id: "t10", name: "Thomas Garcia",    firstName: "Thomas",   lastName: "Garcia",     subject: "History",    gradeLevel: ["11"],          observations: [
    obs("2026-01-28",[4,4,3,4,3,4,3,4,3,4], "Masterful presence; students deeply engaged with material.", "Ratio and F15 Launch are the two 3s — both coachable areas.", "Coach Mills"),
    obs("2026-02-24",[4,4,4,4,4,4,4,4,3,4], "Annotations at 3 — only outlier. Remarkable consistency.", "Push annotations to 4 by embedding a notebook protocol into his launch routine.", "VP Okafor"),
    obs("2026-03-24",[4,4,4,4,4,4,4,4,4,4], "Perfect across all domains. A truly exemplary teacher.", "Formal instructional leadership role — champion for GBF practices school-wide."),
  ]},
  { id: "t11", name: "Rachel Kim",       firstName: "Rachel",   lastName: "Kim",        subject: "English",    gradeLevel: ["8"],           observations: [
    obs("2026-01-10",[3,3,2,3,3,2,3,3,2,3], "Clear routines; students feel safe and engaged.", "Ratio and annotations are areas of growth — structured protocols needed.", "VP Okafor"),
    obs("2026-02-14",[3,3,3,3,3,3,3,3,3,3], "All domains at 3 — great consistency. F15 launch was strong.", "Look for moments to push toward exemplary; she's ready.", "Coach Mills"),
    obs("2026-03-12",[3,3,3,4,3,3,3,3,3,3], "Joy was exemplary today — genuine celebration culture.", "Replicate those joy conditions across other domains."),
  ]},
  { id: "t12", name: "Brian Foster",     firstName: "Brian",    lastName: "Foster",     subject: "Math",       gradeLevel: ["3","4"],       observations: [
    obs("2026-01-15",[2,2,3,2,2,2,3,2,2,2], "F15 Launch and F15 Fluency are consistent strengths.", "Confident presence and ratio still developing. Work on assertive stance and cold-calling.", "Coach Mills"),
    obs("2026-02-20",[3,2,3,2,3,2,3,2,3,2], "Ratio and F15 Entry improving. Better use of checking for understanding.", "WTD and Joy still at 2 — consider injecting more energy and celebration.", "VP Okafor"),
    obs("2026-03-18",[3,3,3,3,3,3,3,3,3,3], "All domains at 3 — real growth since January. Great job, Brian!", "Sustain and begin targeting one domain for exemplary."),
  ]},
  { id: "t13", name: "Monica Alvarez",   firstName: "Monica",   lastName: "Alvarez",    subject: "Science",    gradeLevel: ["11","12"],     observations: [
    obs("2026-01-08",[4,3,3,4,4,3,4,3,4,4], "Presence and joy are standout strengths. Students are fully invested.", "WTD and F15 Fluency at 3 — sharpen the cycle and oral fluency drills.", "VP Okafor"),
    obs("2026-02-11",[4,4,4,4,4,4,4,4,4,4], "All exemplary. Exceptional lesson observed.", "Continue at this level. Mentoring others would multiply her impact.", "Coach Mills"),
    obs("2026-03-10",[4,4,4,4,4,4,4,4,4,4], "Consistently outstanding across every domain.", "Peer coaching and formal leadership are natural next steps."),
  ]},
  { id: "t14", name: "Derek Thompson",   firstName: "Derek",    lastName: "Thompson",   subject: "History",    gradeLevel: ["8"],           observations: [
    obs("2026-01-22",[2,1,2,2,2,2,1,2,1,2], "Eager and responsive to feedback.", "WTD cycle and F15 Launch are critical gaps. Needs structured coaching plan.", "Coach Mills"),
    obs("2026-02-25",[2,2,2,2,2,2,2,2,2,2], "All domains at 2 — steady progress since January.", "Moving from 2 to 3 requires intentionality. Pick one domain and focus there for March.", "VP Okafor"),
    obs("2026-03-20",[2,2,3,2,2,2,2,2,2,2], "Ratio showed a real 3 today — best lesson of the year.", "Build on that ratio success. What conditions made it happen? Replicate them."),
  ]},
  { id: "t15", name: "Stephanie Lee",    firstName: "Stephanie", lastName: "Lee",       subject: "Music",      gradeLevel: ["K","1","2"],   observations: [
    obs("2026-01-12",[3,3,4,4,3,3,4,3,3,3], "Ratio and joy are standouts. Music class is a model for culture.", "Consistent presence and WTD cycle could be sharpened further.", "VP Okafor"),
    obs("2026-02-16",[4,3,4,4,4,3,4,3,3,4], "Nearly all exemplary — F15 Fluency and LP & Mks are the 3s.", "Focus on LP and Mks precision to reach full exemplary status.", "Coach Mills"),
    obs("2026-03-14",[4,4,4,4,4,4,4,4,3,4], "One of our strongest teachers. Annotations at 3 is the remaining gap.", "Embed notebook habits into music journals — close the final gap."),
  ]},
  { id: "t16", name: "Carlos Reyes",     firstName: "Carlos",   lastName: "Reyes",      subject: "PE",         gradeLevel: ["9","10","11","12"], observations: [
    obs("2026-01-18",[3,3,3,4,3,3,3,3,2,3], "Joy is exemplary — PE culture is a school highlight.", "Annotations still at 2. Needs a PE-adapted notebook protocol.", "Coach Mills"),
    obs("2026-02-22",[3,3,4,4,3,3,3,3,3,3], "Ratio improving — more student-led demonstrations.", "Continue ratio growth. Annotations now at 3 — strong improvement.", "VP Okafor"),
    obs("2026-03-19",[4,3,4,4,4,3,4,3,3,4], "Confident presence and ratio at exemplary — impressive development.", "WTD cycle and fluency are next targets for exemplary."),
  ]},
  { id: "t17", name: "Nicole Harris",    firstName: "Nicole",   lastName: "Harris",     subject: "Special Ed", gradeLevel: ["3","4","5"],   observations: [
    obs("2026-01-20",[2,2,2,2,2,2,2,2,2,2], "Caring and attentive to student needs.", "All domains at 2. Needs coaching on routines and presence to move up.", "VP Okafor"),
    obs("2026-02-18",[2,2,3,2,2,2,2,2,3,2], "Ratio and annotations are at 3 — real bright spots.", "Translate that success to other domains. Confident presence is next.", "Coach Mills"),
    obs("2026-03-16",[3,2,3,3,3,2,3,2,3,3], "Four domains now at 3 — great trajectory. Clear growth.", "WTD and F15 Fluency are the remaining 2s. Schedule a targeted coaching session."),
  ]},
  { id: "t18", name: "Paul Wright",      firstName: "Paul",     lastName: "Wright",     subject: "Math",       gradeLevel: ["12"],          observations: [
    obs("2026-01-25",[4,4,4,3,4,4,4,4,3,4], "Veteran excellence. Math instruction is masterful.", "Joy and annotations at 3 — consider intentional celebration moments.", "Coach Mills"),
    obs("2026-02-28",[4,4,4,4,4,4,4,4,4,4], "Full exemplary across all domains. Outstanding lesson.", "Model this practice. Encourage him to open his classroom to peer visits.", "VP Okafor"),
    obs("2026-03-22",[4,4,4,4,4,4,4,4,4,4], "Consistent excellence. A cornerstone of our instructional team.", "Peer coaching, formal mentorship, and instructional leadership opportunities."),
  ]},
  { id: "t19", name: "Julia Morgan",     firstName: "Julia",    lastName: "Morgan",     subject: "English",    gradeLevel: ["1"],           observations: [
    obs("2026-01-14",[1,1,2,2,1,2,1,1,2,1], "Warm relationship with young students; they trust her.", "Classroom management needs serious attention. Priority: entry routine and presence.", "VP Okafor"),
    obs("2026-02-17",[2,2,2,2,2,2,2,2,2,2], "Entry is much better — big win after focused coaching.", "All domains at 2 — the ceiling for the month. Plan for targeted domain growth in March.", "Coach Mills"),
    obs("2026-03-15",[2,2,2,3,2,2,2,2,2,2], "Joy at 3 — students genuinely celebrated a reading milestone.", "Harness that joy energy. Translate celebration culture into other domains."),
  ]},
  { id: "t20", name: "Anthony Clark",    firstName: "Anthony",  lastName: "Clark",      subject: "Art",        gradeLevel: ["6","7","8"],   observations: [
    obs("2026-01-28",[3,2,3,4,3,2,3,2,3,3], "Joy and presence are consistent strengths — art room culture is vibrant.", "WTD cycle and F15 Fluency at 2 — need more structured protocols.", "Coach Mills"),
    obs("2026-02-24",[3,3,3,4,3,3,3,3,3,3], "WTD and F15 Fluency improved significantly. Joy remains exemplary.", "Sustain this progress. Ready to target one additional exemplary domain.", "VP Okafor"),
    obs("2026-03-24",[3,3,3,4,3,3,3,3,3,3], "Consistent across the board. Strong and reliable.", "Joy is naturally exemplary — now coach joy into other domains as a lever."),
  ]},
];

export function getMostRecentObservation(teacher: Teacher): Observation | null {
  if (!teacher.observations.length) return null;
  return teacher.observations.reduce((latest, obs) =>
    obs.date > latest.date ? obs : latest
  );
}

export function getTeacherAverage(teacher: Teacher): number | null {
  const recent = getMostRecentObservation(teacher);
  if (!recent) return null;
  const scores = Object.values(recent.scores) as Score[];
  if (!scores.length) return null;
  return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}

export function getDomainAverage(domainId: string, teachers: Teacher[]): number {
  const scores = teachers
    .map((t) => {
      const recent = getMostRecentObservation(t);
      return recent ? ((recent.scores[domainId] ?? null) as number | null) : null;
    })
    .filter((s): s is number => s !== null);
  if (!scores.length) return 0;
  return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}

export function generateObsId(): string {
  return `obs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
