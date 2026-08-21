import { describe, it, expect } from "vitest";
import { rubricSetsForTeacher } from "./subject-audience";

/*
 * Which rubrics show on a teacher's profile (backlog #19).
 *
 * The case that prompted this: Alyssa Powell, an elementary Classroom Culture
 * teacher, had four rubrics on her profile — two school-wide ones and a 5-12
 * STEM rubric. The school-wide and grade-span filters live on the dashboard
 * and were simply never passed down. This function is the remaining piece:
 * subject.
 */

const set = (slug: string, subjectAudience: "STEM" | "HUMANITIES" | "ALL" | null) =>
  ({ slug, subjectAudience });

const SETS = [
  set("classroom-culture", "ALL"),
  set("stem-q1",           "STEM"),
  set("humanities-q1",     "HUMANITIES"),
];

const slugs = (subject: string | null | undefined) =>
  rubricSetsForTeacher(SETS, subject).map((s) => s.slug);

describe("rubricSetsForTeacher", () => {
  it("gives a STEM teacher the general and STEM rubrics", () => {
    expect(slugs("Math")).toEqual(["classroom-culture", "stem-q1"]);
    expect(slugs("Science")).toEqual(["classroom-culture", "stem-q1"]);
  });

  it("gives a Humanities teacher the general and Humanities rubrics", () => {
    expect(slugs("English")).toEqual(["classroom-culture", "humanities-q1"]);
    expect(slugs("History")).toEqual(["classroom-culture", "humanities-q1"]);
  });

  it("never shows a STEM rubric to a Humanities teacher, or the reverse", () => {
    expect(slugs("English")).not.toContain("stem-q1");
    expect(slugs("Math")).not.toContain("humanities-q1");
  });

  it("gives Art, PE and Music teachers only the general rubrics", () => {
    /* They classify as neither STEM nor Humanities, so a subject-specific
       rubric does not apply to them. */
    for (const subject of ["Art", "PE", "Physical Education", "Music"]) {
      expect(slugs(subject)).toEqual(["classroom-culture"]);
    }
  });

  it("gives a teacher with no department only the general rubrics", () => {
    /* The known cost of this rule: a department missing by mistake looks
       identical to Art or PE, and a rubric quietly stops appearing. Accepted
       deliberately, because it matches how the dashboard already filters. */
    expect(slugs(null)).toEqual(["classroom-culture"]);
    expect(slugs(undefined)).toEqual(["classroom-culture"]);
    expect(slugs("")).toEqual(["classroom-culture"]);
  });

  it("treats a rubric with no subject set as applying to everyone", () => {
    const withNull = [set("legacy", null)];
    expect(rubricSetsForTeacher(withNull, "Math")).toHaveLength(1);
    expect(rubricSetsForTeacher(withNull, "English")).toHaveLength(1);
    expect(rubricSetsForTeacher(withNull, null)).toHaveLength(1);
  });

  it("can return nothing at all", () => {
    /* A STEM teacher where only a Humanities rubric survives the school-level
       filters. The profile shows a message rather than pretending. */
    expect(rubricSetsForTeacher([set("humanities-q1", "HUMANITIES")], "Math")).toEqual([]);
  });

  it("keeps the order it was given", () => {
    /* The profile falls back to the first applicable rubric, so order has to
       be the caller's, not this function's. */
    const reordered = [set("stem-q1", "STEM"), set("classroom-culture", "ALL")];
    expect(rubricSetsForTeacher(reordered, "Math").map((s) => s.slug))
      .toEqual(["stem-q1", "classroom-culture"]);
  });
});
