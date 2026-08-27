import { describe, it, expect } from "vitest";
import { teacherMatchesAudience, classifySubject } from "@/lib/subject-audience";

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
