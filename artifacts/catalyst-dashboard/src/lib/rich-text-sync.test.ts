import { describe, it, expect } from "vitest";
import { decideEditorSync, isEmptyRichText, type EditorSyncState } from "@/lib/rich-text-sync";

/* A settled editor, quietly holding what the parent gave it. */
const at = (html: string, over: Partial<EditorSyncState> = {}): EditorSyncState => ({
  incoming:        html,
  currentHtml:     html,
  editorIsEmpty:   isEmptyRichText(html),
  editorIsFocused: false,
  ...over,
});

describe("isEmptyRichText", () => {
  it("treats TipTap's several spellings of nothing as empty", () => {
    expect(isEmptyRichText("")).toBe(true);
    expect(isEmptyRichText(null)).toBe(true);
    expect(isEmptyRichText(undefined)).toBe(true);
    expect(isEmptyRichText("<p></p>")).toBe(true);
    expect(isEmptyRichText("<p><br></p>")).toBe(true);
    expect(isEmptyRichText("   ")).toBe(true);
  });

  it("does not mistake real text for empty", () => {
    expect(isEmptyRichText("<p>Strong questioning technique</p>")).toBe(false);
    expect(isEmptyRichText("<p>0</p>")).toBe(false);
  });
});

describe("decideEditorSync", () => {
  it("writes a resumed draft into an editor that was built empty", () => {
    /* Backlog #36 exactly: the modal opens, the editor is created with nothing,
       and the saved glows arrive a moment later. */
    expect(decideEditorSync({
      incoming:        "<p>Great use of wait time</p>",
      currentHtml:     "<p></p>",
      editorIsEmpty:   true,
      editorIsFocused: false,
    })).toBe("replace");
  });

  it("does nothing when the editor already shows that text", () => {
    expect(decideEditorSync(at("<p>Great use of wait time</p>"))).toBe("none");
  });

  it("leaves a focused editor alone", () => {
    /* Every keystroke raises onChange, which updates value, which lands back
       here. Writing then would move the caret to the end on every character. */
    expect(decideEditorSync({
      incoming:        "<p>Great use of wait ti</p>",
      currentHtml:     "<p>Great use of wait tim</p>",
      editorIsEmpty:   false,
      editorIsFocused: true,
    })).toBe("none");
  });

  it("clears when the parent empties the field", () => {
    expect(decideEditorSync({
      incoming:        "",
      currentHtml:     "<p>Left over from the last teacher</p>",
      editorIsEmpty:   false,
      editorIsFocused: false,
    })).toBe("clear");
  });

  it("still clears a focused editor — a form reset must work mid-sentence", () => {
    /* This cannot fight a typist: if somebody is typing, incoming is not empty
       and this branch is never reached. */
    expect(decideEditorSync({
      incoming:        "",
      currentHtml:     "<p>Half a sentence</p>",
      editorIsEmpty:   false,
      editorIsFocused: true,
    })).toBe("clear");
  });

  it("does not clear an editor that is already empty", () => {
    expect(decideEditorSync({
      incoming:        "",
      currentHtml:     "<p></p>",
      editorIsEmpty:   true,
      editorIsFocused: false,
    })).toBe("none");
  });

  it("treats an empty incoming value and TipTap's empty paragraph as the same", () => {
    expect(decideEditorSync({
      incoming:        "<p></p>",
      currentHtml:     "<p></p>",
      editorIsEmpty:   true,
      editorIsFocused: false,
    })).toBe("none");
  });

  it("replaces when switching to another teacher's saved feedback", () => {
    expect(decideEditorSync({
      incoming:        "<p>Second teacher's notes</p>",
      currentHtml:     "<p>First teacher's notes</p>",
      editorIsEmpty:   false,
      editorIsFocused: false,
    })).toBe("replace");
  });

  it("never reports replace when it would lose what somebody is writing", () => {
    /* The property that matters: while focused, the only action ever taken is
       to clear, and only when the parent asked for empty. */
    const focusedCases: EditorSyncState[] = [
      { incoming: "<p>a</p>",  currentHtml: "<p>ab</p>", editorIsEmpty: false, editorIsFocused: true },
      { incoming: "<p>ab</p>", currentHtml: "<p>a</p>",  editorIsEmpty: false, editorIsFocused: true },
      { incoming: "<p>x</p>",  currentHtml: "<p></p>",   editorIsEmpty: true,  editorIsFocused: true },
    ];
    for (const c of focusedCases) {
      expect(decideEditorSync(c)).not.toBe("replace");
    }
  });
});
