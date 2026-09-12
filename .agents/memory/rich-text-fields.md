---
name: Rich-text fields — glows, grows, action steps
description: All three are written in RichTextEditor and stored as HTML, but older and phone-written rows are plain text; render with RichTextDisplay, flatten with richTextToPlainText, test emptiness with isBlankRichText
---

## Rule
`observations.strengths`, `observations.growth_areas` and `action_steps.text` (and a draft's `pending_action_step_text`) can each hold **either** HTML from the dashboard's TipTap editor **or** plain text. Both are live in the data. Action steps became rich text on 2026-09-12; everything assigned before that, and everything typed on the phone, is plain.

**Why:** The phone app has plain textareas, and rows written before the editor were never migrated. Code that assumes one shape shows raw `<p><strong>` tags, or collapses a multi-line plain entry into one line.

**How to apply:**
- Rendering: `RichTextDisplay` (dashboard and a copy in catalyst-mobile — the apps share no components, so keep them in step). It sanitises with DOMPurify and handles both shapes.
- Anywhere HTML cannot render — a truncated table cell, a `title` attribute, the phone's textarea, text handed to the AI — use `richTextToPlainText` from `@workspace/api-types` (`{ singleLine: true }` for one-line spots). An AI prompt given raw HTML can quote the tags back into its narrative.
- Emptiness: `isBlankRichText`, never `.trim() === ""`. An emptied editor returns `<p></p>`, and an abandoned bullet list `<ul><li><p></p></li></ul>`.
- Loading plain text into the editor goes through `toEditorHtml` (inside `RichTextEditor`), which turns line breaks into paragraphs. TipTap alone reads `"a\nb"` as HTML and saves it back as `"<p>a b</p>"`.
- The email already routes all three through `richToEmailHtml` in `lib/observation-email.ts`.
