import { describe, it, expect } from "vitest";
import { parseSchoolCsv, CSV_HEADERS } from "./parseSchoolCsv";

const VALID_HEADER = CSV_HEADERS.join(",");

describe("parseSchoolCsv", () => {
  describe("header validation", () => {
    it("accepts a correct header row", () => {
      const csv = [VALID_HEADER, `"NSA Newark ES","North Star Academy Newark Elementary","NSA_NWK_ES","Newark","ES"`].join("\n");
      const { headerError } = parseSchoolCsv(csv);
      expect(headerError).toBeNull();
    });

    it("returns a headerError when the file is completely empty", () => {
      const { headerError } = parseSchoolCsv("");
      expect(headerError).not.toBeNull();
      expect(headerError).toMatch(/empty/i);
    });

    it("returns a headerError when header columns are in wrong order", () => {
      const badHeader = "Full Name,Display Name,Abbreviation,Region,Grade Span";
      const { headerError } = parseSchoolCsv(badHeader + "\n");
      expect(headerError).not.toBeNull();
    });

    it("returns a headerError when there are too few header columns", () => {
      const { headerError } = parseSchoolCsv("Display Name,Full Name,Abbreviation,Region\n");
      expect(headerError).not.toBeNull();
    });

    it("returns a headerError when there are too many header columns", () => {
      const { headerError } = parseSchoolCsv(VALID_HEADER + ",Extra\n");
      expect(headerError).not.toBeNull();
    });
  });

  describe("quoted fields with commas", () => {
    it("parses a school name that contains a comma", () => {
      const csv = [
        VALID_HEADER,
        `"North Star Academy, Newark ES","North Star Academy Newark Elementary","NSA_NWK_ES","Newark","ES"`,
      ].join("\n");
      const { rows, headerError } = parseSchoolCsv(csv);
      expect(headerError).toBeNull();
      expect(rows).toHaveLength(1);
      expect(rows[0].displayName).toBe("North Star Academy, Newark ES");
    });

    it("parses multiple fields with commas when all are quoted", () => {
      const csv = [
        VALID_HEADER,
        `"School A, ES","North Star Academy, Newark, Elementary School","NS_ES","Newark","ES"`,
      ].join("\n");
      const { rows, headerError } = parseSchoolCsv(csv);
      expect(headerError).toBeNull();
      expect(rows[0].displayName).toBe("School A, ES");
      expect(rows[0].fullName).toBe("North Star Academy, Newark, Elementary School");
    });
  });

  describe("Windows CRLF line endings", () => {
    it("parses a CSV with CRLF line endings correctly", () => {
      const csv = [VALID_HEADER, `"NSA Newark ES","North Star Academy Newark Elementary","NSA_NWK_ES","Newark","ES"`].join("\r\n");
      const { rows, headerError } = parseSchoolCsv(csv);
      expect(headerError).toBeNull();
      expect(rows).toHaveLength(1);
      expect(rows[0].region).toBe("Newark");
    });
  });

  describe("BOM character", () => {
    it("handles a UTF-8 BOM at the start of the file without corrupting the header", () => {
      const bom = "\uFEFF";
      const csv = bom + VALID_HEADER + "\n" + `"NSA ES","NSA Elementary","NSA_ES","Camden","MS"`;
      const { rows, headerError } = parseSchoolCsv(csv);
      expect(headerError).toBeNull();
      expect(rows).toHaveLength(1);
    });
  });

  describe("trailing newlines and blank rows", () => {
    it("ignores a single trailing newline", () => {
      const csv = VALID_HEADER + "\n" + `"NSA ES","NSA Elementary","NSA_ES","Camden","MS"` + "\n";
      const { rows } = parseSchoolCsv(csv);
      expect(rows).toHaveLength(1);
    });

    it("ignores multiple trailing blank lines", () => {
      const csv = VALID_HEADER + "\n" + `"NSA ES","NSA Elementary","NSA_ES","Camden","MS"` + "\n\n\n";
      const { rows } = parseSchoolCsv(csv);
      expect(rows).toHaveLength(1);
    });
  });

  describe("rows with wrong column count", () => {
    it("produces a row with empty fields when a data row has too few columns", () => {
      const csv = [VALID_HEADER, `"NSA ES","NSA Elementary","NSA_ES"`].join("\n");
      const { rows, headerError } = parseSchoolCsv(csv);
      expect(headerError).toBeNull();
      expect(rows).toHaveLength(1);
      expect(rows[0].region).toBe("");
      expect(rows[0].gradeSpan).toBe("");
    });

    it("still parses the first 5 fields when a row has extra columns", () => {
      const csv = [VALID_HEADER, `"NSA ES","NSA Elementary","NSA_ES","Camden","MS","extra_col"`].join("\n");
      const { rows, headerError } = parseSchoolCsv(csv);
      expect(headerError).toBeNull();
      expect(rows).toHaveLength(1);
      expect(rows[0].gradeSpan).toBe("MS");
    });
  });

  describe("whitespace trimming", () => {
    it("trims leading and trailing whitespace from all fields", () => {
      const csv = [VALID_HEADER, `  NSA ES  ,  NSA Elementary  ,  NSA_ES  ,  Camden  ,  MS  `].join("\n");
      const { rows, headerError } = parseSchoolCsv(csv);
      expect(headerError).toBeNull();
      expect(rows[0].displayName).toBe("NSA ES");
      expect(rows[0].region).toBe("Camden");
      expect(rows[0].gradeSpan).toBe("MS");
    });
  });

  describe("multiple data rows", () => {
    it("returns all rows from a file with multiple data rows", () => {
      const csv = [
        VALID_HEADER,
        `"NSA Newark ES","NSA Newark Elementary","NSA_NWK_ES","Newark","ES"`,
        `"NSA Camden MS","NSA Camden Middle","NSA_CAM_MS","Camden","MS"`,
        `"NSA Boston HS","NSA Boston High School","NSA_BOS_HS","Boston","HS"`,
      ].join("\n");
      const { rows, headerError } = parseSchoolCsv(csv);
      expect(headerError).toBeNull();
      expect(rows).toHaveLength(3);
      expect(rows[1].gradeSpan).toBe("MS");
      expect(rows[2].abbreviation).toBe("NSA_BOS_HS");
    });
  });
});
