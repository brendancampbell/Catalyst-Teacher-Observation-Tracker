import { describe, it, expect } from "vitest";
import { teacherMatchesAudience, classifySubject } from "@/lib/subject-audience";

/**
 * Every department, and where it lands.
 *
 * The dashboard classifies by keyword and the mobile app by an explicit map,
 * and they drifted: Spanish was in mobile's map but missing from the
 * dashboard's Humanities keywords, so the same teacher appeared under a
 * Humanities rubric on a phone and vanished on a desktop for months. Mobile
 * had a per-department test and the dashboard did not, which is why only one
 * side was ever checked. This is that table.
 */

/**
 * SpEd belongs to every audience.
 *
 * The trap here is that classifying somebody "ALL" does the OPPOSITE of what
 * it sounds like: it means they appear only when the rubric audience is "ALL",
 * which is the narrowest outcome available. A SpEd teacher may teach any
 * subject, so they have to match every audience instead.
 */
describe("SpEd teachers appear under every rubric", () => {
  it("matches a STEM rubric", () => {
    expect(teacherMatchesAudience("SpEd", "STEM")).toBe(true);
  });

  it("matches a Humanities rubric", () => {
    expect(teacherMatchesAudience("SpEd", "HUMANITIES")).toBe(true);
  });

  it("matches an ALL rubric", () => {
    expect(teacherMatchesAudience("SpEd", "ALL")).toBe(true);
  });

  it("is not case or whitespace sensitive", () => {
    expect(teacherMatchesAudience(" sped ", "STEM")).toBe(true);
    expect(teacherMatchesAudience("SPED", "HUMANITIES")).toBe(true);
  });
});

describe("every department lands where it should", () => {
  /* The whole enum, so a gap cannot hide. Mirrors the mobile app's table —
     the two must agree or a teacher's visibility depends on their coach's
     device. */
  const EXPECTED: Array<[string, "STEM" | "HUMANITIES" | "ALL"]> = [
    ["English",              "HUMANITIES"],
    ["Math",                 "STEM"],
    ["Science",              "STEM"],
    ["History",              "HUMANITIES"],
    ["Spanish",              "HUMANITIES"],
    ["Physical Education",   "ALL"],
    ["Comp Sci/Engineering", "STEM"],
    ["Visual Arts",          "ALL"],
    ["College",              "ALL"],
    ["SpEd",                 "ALL"],
    ["Other",                "ALL"],
  ];

  for (const [dept, audience] of EXPECTED) {
    it(`classifies ${dept} as ${audience}`, () => {
      expect(classifySubject(dept)).toBe(audience);
    });
  }

  it("puts a Spanish teacher on a Humanities rubric", () => {
    /* The drift itself: true on mobile, false here, for months. */
    expect(teacherMatchesAudience("Spanish", "HUMANITIES")).toBe(true);
    expect(teacherMatchesAudience("Spanish", "STEM")).toBe(false);
  });
});

describe("everyone else is unchanged", () => {
  it("a Maths teacher does not appear under a Humanities rubric", () => {
    expect(teacherMatchesAudience("Math", "HUMANITIES")).toBe(false);
    expect(teacherMatchesAudience("Math", "STEM")).toBe(true);
  });

  it("an English teacher does not appear under a STEM rubric", () => {
    expect(teacherMatchesAudience("English", "STEM")).toBe(false);
    expect(teacherMatchesAudience("English", "HUMANITIES")).toBe(true);
  });

  it("an unclassified department still appears only on an ALL rubric", () => {
    /* The behaviour SpEd deliberately does NOT have. */
    for (const dept of ["Visual Arts", "College", "Other", "Physical Education"]) {
      expect(teacherMatchesAudience(dept, "STEM")).toBe(false);
      expect(teacherMatchesAudience(dept, "HUMANITIES")).toBe(false);
      expect(teacherMatchesAudience(dept, "ALL")).toBe(true);
    }
  });

  it("a teacher with no department still appears only on an ALL rubric", () => {
    expect(teacherMatchesAudience(null, "STEM")).toBe(false);
    expect(teacherMatchesAudience(null, "ALL")).toBe(true);
  });

  it("classifySubject still reports SpEd as ALL", () => {
    /* The bucket is unchanged; only the matching rule treats it specially, so
       anything displaying the classification reads the same as before. */
    expect(classifySubject("SpEd")).toBe("ALL");
  });
});
