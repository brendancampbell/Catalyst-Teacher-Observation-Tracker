// @vitest-environment jsdom
/**
 * #61 — the push/replace line, which is the decision the whole change rests on.
 *
 * Back must step out of a school or a teacher, and must never unwind a filter
 * one value at a time. That means drilling in pushes a history entry and
 * everything else replaces the current one — so a link still matches the screen
 * it came from, without every filter change costing a Back press.
 *
 * Guarded here rather than only through the Dashboard because both the Action
 * Center and Admin route their view state through the same hook: a regression
 * in this policy would show up on three screens at once.
 */

import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { Router as WouterRouter } from "wouter";
import { useUrlState, readList, writeList, readEnum } from "@/lib/urlState";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <WouterRouter base="">{children}</WouterRouter>
);

function currentSearch() {
  return window.location.search;
}

/** jsdom queues history traversal, so a bare tick is not enough — wait for the
    popstate the traversal actually fires. */
function waitForPopstate(trigger: () => void) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("no popstate within 1s; the address never moved")),
      1000,
    );
    window.addEventListener("popstate", () => { clearTimeout(timer); resolve(); }, { once: true });
    trigger();
  });
}

describe("readList / writeList", () => {
  it("reads a comma-joined param", () => {
    const p = new URLSearchParams("subjects=Math,Science");
    expect(readList(p, "subjects")).toEqual(["Math", "Science"]);
  });

  it("reads an absent param as empty rather than throwing", () => {
    expect(readList(new URLSearchParams(""), "subjects")).toEqual([]);
  });

  it("drops the empty strings a trailing comma would produce", () => {
    const p = new URLSearchParams("grades=K,,3,");
    expect(readList(p, "grades")).toEqual(["K", "3"]);
  });

  it("writes an empty list as null, so a cleared filter leaves no trace", () => {
    /* Not "" — the key has to disappear from a link someone is about to
       paste, rather than linger as `subjects=`. */
    expect(writeList([])).toBeNull();
    expect(writeList(["Math"])).toBe("Math");
  });
});

describe("readEnum", () => {
  const MODES = ["recent", "periodAvg", "walkthroughs"] as const;

  it("accepts a known value", () => {
    const p = new URLSearchParams("view=walkthroughs");
    expect(readEnum(p, "view", MODES, "recent")).toBe("walkthroughs");
  });

  it("falls back when the param is absent", () => {
    expect(readEnum(new URLSearchParams(""), "view", MODES, "recent")).toBe("recent");
  });

  it("falls back on a stale or hand-edited value instead of rendering it", () => {
    /* A link shared before a view was renamed must still open something. */
    const p = new URLSearchParams("view=nonsense");
    expect(readEnum(p, "view", MODES, "recent")).toBe("recent");
  });
});

describe("useUrlState", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  /* jsdom keeps one history per test file, so every test below plants its own
     sentinel entry and asserts against that rather than against whatever the
     previous test happened to leave behind. */

  it("replace costs no Back press, however many filters you set", async () => {
    const { result } = renderHook(() => useUrlState(), { wrapper });

    act(() => { result.current.setParams({ marker: "list" },  "push"); });
    act(() => { result.current.setParams({ marker: "school" }, "push"); });

    act(() => { result.current.setParams({ subjects: "Math" }, "replace"); });
    act(() => { result.current.setParams({ grades:   "K" },    "replace"); });
    act(() => { result.current.setParams({ prof: "Proficient" }, "replace"); });
    expect(new URLSearchParams(currentSearch()).get("subjects")).toBe("Math");

    /* One press, straight past all three filters, to the list you came from —
       not three presses unwinding them one at a time. */
    await act(async () => { await waitForPopstate(() => window.history.back()); });
    expect(currentSearch()).toBe("?marker=list");
  });

  it("push adds an entry, so Back steps back out of a drill-in", async () => {
    const { result } = renderHook(() => useUrlState(), { wrapper });

    act(() => { result.current.setParams({ schoolId: "5" }, "push"); });
    act(() => { result.current.setParams({ teacher: "t1" }, "push"); });
    expect(new URLSearchParams(currentSearch()).get("teacher")).toBe("t1");

    await act(async () => { await waitForPopstate(() => window.history.back()); });
    expect(new URLSearchParams(currentSearch()).get("teacher")).toBeNull();
    expect(new URLSearchParams(currentSearch()).get("schoolId")).toBe("5");
  });

  it("keeps params it was not asked to change", () => {
    window.history.replaceState(null, "", "/?schoolId=5&rubric=q1");
    const { result } = renderHook(() => useUrlState(), { wrapper });

    act(() => { result.current.setParams({ subjects: "Math" }, "replace"); });

    const p = new URLSearchParams(currentSearch());
    expect(p.get("schoolId")).toBe("5");
    expect(p.get("rubric")).toBe("q1");
    expect(p.get("subjects")).toBe("Math");
  });

  it("removes a key set to null rather than leaving it empty", () => {
    window.history.replaceState(null, "", "/?subjects=Math&grades=K");
    const { result } = renderHook(() => useUrlState(), { wrapper });

    act(() => { result.current.setParams({ subjects: null }, "replace"); });
    expect(currentSearch()).toBe("?grades=K");
  });

  it("leaves no trailing ? when the last param goes", () => {
    /* Cosmetic, but the address is shown to the user and pasted into email. */
    window.history.replaceState(null, "", "/?subjects=Math");
    const { result } = renderHook(() => useUrlState(), { wrapper });

    act(() => { result.current.setParams({ subjects: null }, "replace"); });
    expect(window.location.href.endsWith("?")).toBe(false);
    expect(currentSearch()).toBe("");
  });

  it("closeParams unwinds the entry it pushed, rather than stacking another", async () => {
    const { result } = renderHook(() => useUrlState(), { wrapper });

    act(() => { result.current.setParams({ marker: "list" }, "push"); });
    act(() => { result.current.setParams({ schoolId: "5" }, "push"); });
    act(() => { result.current.setParams({ teacher: "t1" }, "push"); });

    await act(async () => {
      await waitForPopstate(() => result.current.closeParams({ teacher: null }));
    });
    expect(new URLSearchParams(currentSearch()).get("teacher")).toBeNull();
    expect(new URLSearchParams(currentSearch()).get("schoolId")).toBe("5");

    /* The entry was consumed, not added to. Without the marker, closing would
       leave [school, school] behind and this press would look like it did
       nothing at all. */
    await act(async () => { await waitForPopstate(() => window.history.back()); });
    expect(currentSearch()).toBe("?marker=list");
  });

  it("closeParams clears in place when the view came from a pasted link", () => {
    /* Arriving on ?teacher=... directly leaves nothing of ours behind, so
       history.back() there would walk the reader out of the app entirely. */
    window.history.replaceState(null, "", "/?schoolId=5&teacher=t1");
    const { result } = renderHook(() => useUrlState(), { wrapper });

    act(() => { result.current.closeParams({ teacher: null }); });
    expect(currentSearch()).toBe("?schoolId=5");
  });
});
