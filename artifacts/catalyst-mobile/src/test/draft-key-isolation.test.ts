/**
 * Draft key isolation tests
 *
 * Verifies that the teacher-scoped localStorage draft key (`localDraftKey`)
 * prevents cross-teacher collisions:
 *
 *  1. Different teachers produce different keys under the same user + rubric.
 *  2. Writing a draft for Teacher B does not clobber Teacher A's draft.
 *  3. Switching back to Teacher A still restores the correct draft.
 *  4. Clearing Teacher B's draft leaves Teacher A's draft untouched.
 *  5. Undefined / missing teacherId falls back to the literal "0" segment.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { localDraftKey } from "@/pages/observation";
import type { LocalDraft } from "@/pages/observation";

/* ── Helpers ──────────────────────────────────────────────────────────── */

function writeDraft(key: string, draft: LocalDraft): void {
  localStorage.setItem(key, JSON.stringify(draft));
}

function readDraft(key: string): LocalDraft | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  return JSON.parse(raw) as LocalDraft;
}

function makeDraft(teacherId: string, strengths: string): LocalDraft {
  return {
    teacherId,
    date: "2026-07-13",
    course: "Math",
    scores: { d1: 1, d2: 0.5 },
    strengths,
    growthAreas: "needs improvement",
    isWalkthrough: false,
    savedAt: Date.now(),
  };
}

const USER_ID    = 42;
const RUBRIC_ID  = 7;
const TEACHER_A  = "emp-001";
const TEACHER_B  = "emp-002";

/* ── Tests ────────────────────────────────────────────────────────────── */

describe("localDraftKey — key generation", () => {
  it("produces different keys for different teachers under the same user + rubric", () => {
    const keyA = localDraftKey(USER_ID, RUBRIC_ID, TEACHER_A);
    const keyB = localDraftKey(USER_ID, RUBRIC_ID, TEACHER_B);
    expect(keyA).not.toBe(keyB);
  });

  it("produces different keys for different rubric sets under the same user + teacher", () => {
    const key1 = localDraftKey(USER_ID, 1, TEACHER_A);
    const key2 = localDraftKey(USER_ID, 2, TEACHER_A);
    expect(key1).not.toBe(key2);
  });

  it("falls back to '0' for undefined teacherId", () => {
    const key = localDraftKey(USER_ID, RUBRIC_ID, undefined);
    expect(key).toBe(`catalyst-mobile-draft-${USER_ID}-${RUBRIC_ID}-0`);
  });

  it("falls back to 'anon' for undefined userId", () => {
    const key = localDraftKey(undefined, RUBRIC_ID, TEACHER_A);
    expect(key).toMatch(/^catalyst-mobile-draft-anon-/);
  });
});

describe("Draft key isolation — localStorage round-trip", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("writing Teacher B's draft does not overwrite Teacher A's draft", () => {
    const keyA = localDraftKey(USER_ID, RUBRIC_ID, TEACHER_A);
    const keyB = localDraftKey(USER_ID, RUBRIC_ID, TEACHER_B);

    writeDraft(keyA, makeDraft(TEACHER_A, "Great lesson structure"));
    writeDraft(keyB, makeDraft(TEACHER_B, "Strong questioning"));

    const restoredA = readDraft(keyA);
    expect(restoredA).not.toBeNull();
    expect(restoredA!.teacherId).toBe(TEACHER_A);
    expect(restoredA!.strengths).toBe("Great lesson structure");
  });

  it("switching back to Teacher A after Teacher B restores the correct draft", () => {
    const keyA = localDraftKey(USER_ID, RUBRIC_ID, TEACHER_A);
    const keyB = localDraftKey(USER_ID, RUBRIC_ID, TEACHER_B);

    writeDraft(keyA, makeDraft(TEACHER_A, "Excellent wait time"));
    writeDraft(keyB, makeDraft(TEACHER_B, "Clear objectives"));

    /* Simulate reading Teacher B first, then switching back to Teacher A */
    const currentB = readDraft(keyB);
    expect(currentB!.teacherId).toBe(TEACHER_B);

    const restoredA = readDraft(keyA);
    expect(restoredA).not.toBeNull();
    expect(restoredA!.teacherId).toBe(TEACHER_A);
    expect(restoredA!.strengths).toBe("Excellent wait time");
  });

  it("clearing Teacher B's draft leaves Teacher A's draft intact", () => {
    const keyA = localDraftKey(USER_ID, RUBRIC_ID, TEACHER_A);
    const keyB = localDraftKey(USER_ID, RUBRIC_ID, TEACHER_B);

    writeDraft(keyA, makeDraft(TEACHER_A, "Strong vocab instruction"));
    writeDraft(keyB, makeDraft(TEACHER_B, "Good pacing"));

    localStorage.removeItem(keyB);

    expect(localStorage.getItem(keyB)).toBeNull();

    const restoredA = readDraft(keyA);
    expect(restoredA).not.toBeNull();
    expect(restoredA!.strengths).toBe("Strong vocab instruction");
  });

  it("draft key embeds the correct teacherId segment for retrieval", () => {
    const key = localDraftKey(USER_ID, RUBRIC_ID, TEACHER_A);
    writeDraft(key, makeDraft(TEACHER_A, "Check for understanding"));

    const restored = readDraft(key);
    expect(restored!.teacherId).toBe(TEACHER_A);

    /* The wrong teacher's key returns null */
    const wrongKey = localDraftKey(USER_ID, RUBRIC_ID, TEACHER_B);
    expect(readDraft(wrongKey)).toBeNull();
  });
});
