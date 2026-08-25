/**
 * Deciding when an incoming `value` should be pushed into a TipTap editor.
 *
 * TipTap applies `content` once, when the editor is created. Everything after
 * that has to be written in deliberately, and writing carelessly is worse than
 * not writing at all: every keystroke raises onChange, which updates value,
 * which lands back here — so an unconditional write moves the caret to the end
 * of the text on every character typed.
 *
 * Kept apart from the component, and pure, so the rules can be tested without a
 * DOM. The dashboard's test environment is `node`, so anything importing
 * @tiptap/react cannot be tested at all.
 *
 * Backlog #36: a resumed draft showed empty glows and grows. The editor had
 * already been created with empty content by the time the saved text arrived,
 * and nothing put it in. Worse than a blank box — the text lived on in React
 * state, so anybody who saw the empty field and typed into it replaced what had
 * been saved, and autosave wrote the loss away.
 */

/** TipTap's representation of "nothing", which is not the same as "". */
const EMPTY_HTML = "<p></p>";

export function isEmptyRichText(html: string | null | undefined): boolean {
  if (!html) return true;
  const trimmed = html.trim();
  return trimmed === "" || trimmed === EMPTY_HTML || trimmed === "<p><br></p>";
}

export type EditorSyncAction = "none" | "clear" | "replace";

export interface EditorSyncState {
  /** The value the parent wants the editor to hold. */
  incoming: string | null | undefined;
  /** What the editor currently holds, via editor.getHTML(). */
  currentHtml: string;
  /** editor.isEmpty — TipTap's own idea of empty, which "" is not. */
  editorIsEmpty: boolean;
  /** editor.isFocused — true while somebody is typing in it. */
  editorIsFocused: boolean;
}

/**
 * What to do with the editor, given what the parent is asking for.
 *
 *   "clear"   — the parent wants it empty and it is not
 *   "replace" — the parent holds text the editor does not have
 *   "none"    — they already agree, or the person is mid-sentence
 */
export function decideEditorSync(state: EditorSyncState): EditorSyncAction {
  const { incoming, currentHtml, editorIsEmpty, editorIsFocused } = state;

  if (isEmptyRichText(incoming)) {
    /* Clearing cannot fight a typist: if they are typing, incoming is not
       empty, so this branch is not reached. A form reset while the caret sits
       in the box is a real case and must still work. */
    return editorIsEmpty ? "none" : "clear";
  }

  /* Somebody is typing. Whatever the parent holds came from their own
     keystrokes a moment ago, so writing it back would only move the caret. */
  if (editorIsFocused) return "none";

  /* Identical content still costs a full document replacement and a scroll
     position, so compare before writing. */
  return incoming === currentHtml ? "none" : "replace";
}
