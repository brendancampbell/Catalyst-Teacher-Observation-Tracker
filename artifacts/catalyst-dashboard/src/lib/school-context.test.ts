// @vitest-environment jsdom
/**
 * teacherProfileHref must carry the school across the navigation.
 *
 * Failure mode prevented: the link is built as a bare `/?teacher=<id>`. For a
 * school leader that works, because the dashboard falls back to their own
 * school. For a NETWORK_ADMIN or NETWORK_LEADER, `/` with no schoolId is the
 * DISTRICT dashboard — it returns before any teacher is looked up, so the
 * profile never opens and the click reads as "it went to the dashboard".
 *
 * That is role-dependent, which is why a test signed in as a school leader
 * cannot see it. This one asserts the link itself.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { teacherProfileHref, schoolContextParams } from "@/lib/school-context";

function setUrl(search: string) {
  window.history.replaceState(null, "", "/action-center" + search);
}

describe("teacherProfileHref", () => {
  beforeEach(() => setUrl(""));
  afterEach(() => setUrl(""));

  it("keeps the schoolId the Action Center was opened with", () => {
    setUrl("?schoolId=7&schoolName=Test%20Prep");
    const href = teacherProfileHref("", "UCS-004821");
    const params = new URLSearchParams(href.split("?")[1]);

    expect(params.get("schoolId")).toBe("7");
    expect(params.get("teacher")).toBe("UCS-004821");
  });

  it("falls back to the signed-in person's own school when the URL has none", () => {
    const href = teacherProfileHref("", "UCS-004821", 3);
    expect(new URLSearchParams(href.split("?")[1]).get("schoolId")).toBe("3");
  });

  it("prefers the URL's school over the fallback — a network admin drilled in", () => {
    /* Their own school is Home Office. Taking the fallback here would send them
       to a dashboard for the wrong school, or to the district one. */
    setUrl("?schoolId=7");
    const href = teacherProfileHref("", "UCS-004821", 99);
    expect(new URLSearchParams(href.split("?")[1]).get("schoolId")).toBe("7");
  });

  it("omits schoolId entirely when there is neither", () => {
    const href = teacherProfileHref("", "UCS-004821", null);
    expect(new URLSearchParams(href.split("?")[1]).has("schoolId")).toBe(false);
  });

  it("respects the base path", () => {
    setUrl("?schoolId=7");
    expect(teacherProfileHref("/app", "UCS-004821").startsWith("/app/?")).toBe(true);
  });

  it("carries the header's school name through, as schoolContextParams does", () => {
    setUrl("?schoolId=7&schoolName=Test%20Prep&schoolAbbreviation=TP");
    const params = new URLSearchParams(teacherProfileHref("", "X").split("?")[1]);
    expect(params.get("schoolName")).toBe("Test Prep");
    expect(params.get("schoolAbbreviation")).toBe("TP");
    /* The helper it builds on must not have been bypassed. */
    expect(schoolContextParams().get("schoolId")).toBe("7");
  });
});
