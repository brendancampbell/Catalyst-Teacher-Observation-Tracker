import { describe, it, expect } from "vitest";
import { parsePeopleCSV } from "./peopleCsv";

const HEADER =
  "firstName,lastName,employeeId,email,role,school,department,gradeLevel,includeInFeedbackTracker";

describe("parsePeopleCSV", () => {
  it("reads a well-formed quoted multi-grade row", () => {
    const { rows, malformed, repaired } = parsePeopleCSV(
      [HEADER, 'Jane,Smith,E1,j@x.org,COACH,Lincoln MS,Math,"4, 5, 6",true'].join("\n"),
    );
    expect(malformed).toHaveLength(0);
    expect(repaired).toBe(0);
    expect(rows[0]!.gradeLevel).toBe("4, 5, 6");
    expect(rows[0]!.includeInFeedbackTracker).toBe("true");
  });

  it("repairs an UNQUOTED multi-grade row without shifting later columns", () => {
    /*
     * The real-world case: the exporter writes 4, 5, 6 without quotes, so the
     * row carries two extra fields. Left alone, includeInFeedbackTracker would
     * receive "5" and the import would silently write nonsense.
     */
    const { rows, malformed, repaired } = parsePeopleCSV(
      [HEADER, "Jane,Smith,E1,j@x.org,COACH,Lincoln MS,Math,4, 5, 6,true"].join("\n"),
    );
    expect(malformed).toHaveLength(0);
    expect(repaired).toBe(1);
    expect(rows[0]!.gradeLevel).toBe("4,5,6");
    expect(rows[0]!.includeInFeedbackTracker).toBe("true");
    expect(rows[0]!.department).toBe("Math");
  });

  it("repairs K and Pre-K tokens too", () => {
    const { rows, repaired } = parsePeopleCSV(
      [HEADER, "Ann,Lee,E2,a@x.org,COACH,Lincoln ES,English,Pre-K, K, 1,true"].join("\n"),
    );
    expect(repaired).toBe(1);
    expect(rows[0]!.gradeLevel).toBe("Pre-K,K,1");
  });

  it("refuses to repair when the overflow is NOT grades", () => {
    /*
     * A comma in a school name has the same symptom. Folding it into
     * gradeLevel would corrupt two columns instead of one, so the row is
     * reported rather than guessed at.
     */
    const { rows, malformed, repaired } = parsePeopleCSV(
      [HEADER, "Jane,Smith,E1,j@x.org,COACH,Lincoln MS, Brooklyn,Math,6,true"].join("\n"),
    );
    expect(repaired).toBe(0);
    expect(rows).toHaveLength(0);
    expect(malformed).toEqual([{ line: 2, got: 10, expected: 9 }]);
  });

  it("leaves single-grade rows untouched", () => {
    const { rows, malformed, repaired } = parsePeopleCSV(
      [HEADER, "Jane,Smith,E1,j@x.org,COACH,Lincoln MS,Math,6,true"].join("\n"),
    );
    expect(malformed).toHaveLength(0);
    expect(repaired).toBe(0);
    expect(rows[0]!.gradeLevel).toBe("6");
  });

  it("handles a file where only some rows are unquoted", () => {
    /* Mirrors the reported file: the first rows are fine, the break starts
       at the first teacher who has more than one grade. */
    const { rows, malformed, repaired } = parsePeopleCSV(
      [
        HEADER,
        "A,One,E1,a@x.org,COACH,Lincoln MS,Math,6,true",
        "B,Two,E2,b@x.org,COACH,Lincoln MS,Math,4, 5, 6,true",
        "C,Three,E3,c@x.org,COACH,Lincoln MS,Math,7,false",
      ].join("\n"),
    );
    expect(malformed).toHaveLength(0);
    expect(repaired).toBe(1);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.gradeLevel)).toEqual(["6", "4,5,6", "7"]);
    expect(rows.map((r) => r.includeInFeedbackTracker)).toEqual(["true", "true", "false"]);
  });
});
