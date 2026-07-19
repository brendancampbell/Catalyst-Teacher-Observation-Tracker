import { describe, it, expect, vi, afterEach } from "vitest";
import { classifySubject, teacherMatchesAudience } from "@/lib/subject-audience";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("classifySubject — known department values", () => {
  it('maps "Math" to "STEM"',                  () => expect(classifySubject("Math")).toBe("STEM"));
  it('maps "Science" to "STEM"',               () => expect(classifySubject("Science")).toBe("STEM"));
  it('maps "Comp Sci/Engineering" to "STEM"',  () => expect(classifySubject("Comp Sci/Engineering")).toBe("STEM"));
  it('maps "English" to "HUMANITIES"',         () => expect(classifySubject("English")).toBe("HUMANITIES"));
  it('maps "History" to "HUMANITIES"',         () => expect(classifySubject("History")).toBe("HUMANITIES"));
  it('maps "Spanish" to "HUMANITIES"',         () => expect(classifySubject("Spanish")).toBe("HUMANITIES"));
  it('maps "Physical Education" to "ALL"',     () => expect(classifySubject("Physical Education")).toBe("ALL"));
  it('maps "Visual Arts" to "ALL"',            () => expect(classifySubject("Visual Arts")).toBe("ALL"));
  it('maps "College" to "ALL"',                () => expect(classifySubject("College")).toBe("ALL"));
  it('maps "Other" to "ALL"',                  () => expect(classifySubject("Other")).toBe("ALL"));
});

describe("classifySubject — null / undefined / empty", () => {
  it("returns ALL for null",            () => expect(classifySubject(null)).toBe("ALL"));
  it("returns ALL for undefined",       () => expect(classifySubject(undefined)).toBe("ALL"));
  it("returns ALL for empty string",    () => expect(classifySubject("")).toBe("ALL"));
  it("returns ALL for whitespace-only", () => expect(classifySubject("   ")).toBe("ALL"));
});

describe("classifySubject — unknown string", () => {
  it("returns ALL and warns for an unknown department", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = classifySubject("Drama");
    expect(result).toBe("ALL");
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("Drama");
  });

  it("does NOT warn for known departments", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    classifySubject("Math");
    classifySubject("Spanish");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("classifySubject — leading/trailing whitespace", () => {
  it('trims whitespace before lookup: "  Math  " → STEM', () => {
    expect(classifySubject("  Math  ")).toBe("STEM");
  });
});

describe("teacherMatchesAudience", () => {
  it("ALL audience always returns true regardless of subject", () => {
    expect(teacherMatchesAudience("Math",     "ALL")).toBe(true);
    expect(teacherMatchesAudience("Spanish",  "ALL")).toBe(true);
    expect(teacherMatchesAudience(null,       "ALL")).toBe(true);
    expect(teacherMatchesAudience(undefined,  "ALL")).toBe(true);
    expect(teacherMatchesAudience("Drama",    "ALL")).toBe(true);
  });

  it("STEM audience returns true only for STEM departments", () => {
    expect(teacherMatchesAudience("Math",                 "STEM")).toBe(true);
    expect(teacherMatchesAudience("Comp Sci/Engineering", "STEM")).toBe(true);
    expect(teacherMatchesAudience("Spanish",              "STEM")).toBe(false);
    expect(teacherMatchesAudience("Physical Education",   "STEM")).toBe(false);
    expect(teacherMatchesAudience(null,                   "STEM")).toBe(false);
  });

  it("HUMANITIES audience returns true only for humanities departments", () => {
    expect(teacherMatchesAudience("English",  "HUMANITIES")).toBe(true);
    expect(teacherMatchesAudience("Spanish",  "HUMANITIES")).toBe(true);
    expect(teacherMatchesAudience("Math",     "HUMANITIES")).toBe(false);
    expect(teacherMatchesAudience("College",  "HUMANITIES")).toBe(false);
    expect(teacherMatchesAudience(null,       "HUMANITIES")).toBe(false);
  });
});
