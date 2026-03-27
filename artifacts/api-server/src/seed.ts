import { db, pool } from "@workspace/db";
import {
  schools, users, teachers,
  rubricQuarters, rubricCategories, rubricDomains,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";

async function seed() {
  console.log("Checking if database needs seeding…");

  const existingQ = await db.select().from(rubricQuarters).where(eq(rubricQuarters.slug, "Q1"));
  if (existingQ.length > 0) {
    console.log("Database already seeded — skipping.");
    await pool.end();
    return;
  }

  console.log("Seeding database…");

  const insertedSchools = await db.insert(schools).values([
    { name: "Lincoln Middle School", region: "Newark",  gradeSpan: "MS" },
    { name: "Washington High School", region: "Boston", gradeSpan: "HS" },
    { name: "Roosevelt Elementary",  region: "NYC",    gradeSpan: "ES" },
  ]).returning();

  const sid = Object.fromEntries(insertedSchools.map((s) => [s.name, s.id]));
  const lincoln    = sid["Lincoln Middle School"];
  const washington = sid["Washington High School"];
  const roosevelt  = sid["Roosevelt Elementary"];

  await db.insert(users).values([
    { email: "principal.rivera@uncommon.org", name: "Principal Rivera", role: "PRINCIPAL",      schoolId: lincoln    },
    { email: "coach.mills@uncommon.org",      name: "Coach Mills",      role: "COACH",           schoolId: lincoln    },
    { email: "vp.okafor@uncommon.org",        name: "VP Okafor",        role: "PRINCIPAL",      schoolId: washington },
    { email: "district.admin@uncommon.org",   name: "District Admin",   role: "DISTRICT_ADMIN", schoolId: null       },
  ]).onConflictDoNothing();

  await db.insert(teachers).values([
    { name: "Sarah Johnson",   subject: "English",    gradeLevel: ["6"],              isActive: true, schoolId: lincoln    },
    { name: "Priya Patel",     subject: "Science",    gradeLevel: ["7"],              isActive: true, schoolId: lincoln    },
    { name: "James Mitchell",  subject: "Math",       gradeLevel: ["6", "7"],         isActive: true, schoolId: lincoln    },
    { name: "Rachel Kim",      subject: "English",    gradeLevel: ["8"],              isActive: true, schoolId: lincoln    },
    { name: "Derek Thompson",  subject: "History",    gradeLevel: ["8"],              isActive: true, schoolId: lincoln    },
    { name: "Anthony Clark",   subject: "Art",        gradeLevel: ["6", "7", "8"],    isActive: true, schoolId: lincoln    },
    { name: "Marcus Williams", subject: "Math",       gradeLevel: ["9", "10"],        isActive: true, schoolId: washington },
    { name: "David Chen",      subject: "History",    gradeLevel: ["10"],             isActive: true, schoolId: washington },
    { name: "Thomas Garcia",   subject: "History",    gradeLevel: ["11"],             isActive: true, schoolId: washington },
    { name: "Monica Alvarez",  subject: "Science",    gradeLevel: ["11", "12"],       isActive: true, schoolId: washington },
    { name: "Carlos Reyes",    subject: "PE",         gradeLevel: ["9","10","11","12"], isActive: true, schoolId: washington },
    { name: "Paul Wright",     subject: "Math",       gradeLevel: ["12"],             isActive: true, schoolId: washington },
    { name: "Amanda Torres",   subject: "English",    gradeLevel: ["5"],              isActive: true, schoolId: roosevelt  },
    { name: "Linda Roberts",   subject: "Science",    gradeLevel: ["4"],              isActive: true, schoolId: roosevelt  },
    { name: "Kevin Nguyen",    subject: "PE",         gradeLevel: ["K", "1", "2"],    isActive: true, schoolId: roosevelt  },
    { name: "Olivia Brown",    subject: "Art",        gradeLevel: ["K", "1", "2"],    isActive: true, schoolId: roosevelt  },
    { name: "Brian Foster",    subject: "Math",       gradeLevel: ["3", "4"],         isActive: true, schoolId: roosevelt  },
    { name: "Stephanie Lee",   subject: "Music",      gradeLevel: ["K", "1", "2"],    isActive: true, schoolId: roosevelt  },
    { name: "Nicole Harris",   subject: "Special Ed", gradeLevel: ["3", "4", "5"],    isActive: true, schoolId: roosevelt  },
    { name: "Julia Morgan",    subject: "English",    gradeLevel: ["1"],              isActive: true, schoolId: roosevelt  },
  ]);

  const [quarter] = await db.insert(rubricQuarters).values([
    { slug: "Q1", name: "Quarter 1", isActive: true },
  ]).returning();

  const insertedCats = await db.insert(rubricCategories).values([
    { quarterId: quarter.id, name: "Classroom Culture",  displayOrder: 0 },
    { quarterId: quarter.id, name: "The First 15",       displayOrder: 1 },
    { quarterId: quarter.id, name: "Academic Monitoring", displayOrder: 2 },
  ]).returning();

  const catId = Object.fromEntries(insertedCats.map((c) => [c.name, c.id]));

  await db.insert(rubricDomains).values([
    { categoryId: catId["Classroom Culture"],  slug: "confident_presence", name: "Confident Presence",          displayOrder: 0 },
    { categoryId: catId["Classroom Culture"],  slug: "wtd_cycle",          name: "WTD Cycle",                   displayOrder: 1 },
    { categoryId: catId["Classroom Culture"],  slug: "ratio_engagement",   name: "Ratio & Engagement",          displayOrder: 2 },
    { categoryId: catId["Classroom Culture"],  slug: "joy",                name: "Joy",                         displayOrder: 3 },
    { categoryId: catId["The First 15"],       slug: "f15_entry",          name: "F15: Entry/ DN/DNR",          displayOrder: 0 },
    { categoryId: catId["The First 15"],       slug: "f15_fluency",        name: "F15: Fluency/OD",             displayOrder: 1 },
    { categoryId: catId["The First 15"],       slug: "f15_launch",         name: "F15: Launch",                 displayOrder: 2 },
    { categoryId: catId["Academic Monitoring"], slug: "lp_mks",            name: "LP & Mks",                   displayOrder: 0 },
    { categoryId: catId["Academic Monitoring"], slug: "annotations",       name: "Annotations & Notebook Habits", displayOrder: 1 },
    { categoryId: catId["Academic Monitoring"], slug: "academic_mon",      name: "Academic Mon. 101",           displayOrder: 2 },
  ]);

  console.log("Database seeded successfully.");
  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
