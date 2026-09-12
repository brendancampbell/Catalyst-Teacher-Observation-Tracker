---
name: Rich-text fields — glows, grows, action steps
description: All three are written in RichTextEditor (dashboard, and a copy on the phone) and stored as HTML, but older rows are plain text; render with RichTextDisplay, flatten with richTextToPlainText, test emptiness with isBlankRichText
---

## Rule
`observations.strengths`, `observations.growth_areas` and `action_steps.text` (and a draft's `pending_action_step_text`) can each hold **either** HTML from a TipTap editor **or** plain text. Both are live in the data. Action steps became rich text on the dashboard on 2026-09-12, and the phone got the editor for all three the same day; everything written before that is plain.

**Why:** Rows written before the editor were never migrated. Code that assumes one shape shows raw `<p><strong>` tags, or collapses a multi-line plain entry into one line.

**How to apply:**
- The editor and display exist twice — `RichTextEditor` / `RichTextDisplay` in catalyst-dashboard and in catalyst-mobile. The apps share no components, so keep the copies in step by hand. The rules both editors follow live once, in `@workspace/api-types` (`decideEditorSync`, `toEditorHtml`).
- Box height is the same rule in both: opens at 3.5 lines, grows to 5, scrolls after. Computed from font size and line height at the top of each editor file; the mobile e2e `text-box-height.spec.ts` mirrors the numbers.
- Anywhere HTML cannot render — a truncated table cell, a `title` attribute, the phone's drafts list, text handed to the AI — use `richTextToPlainText` from `@workspace/api-types` (`{ singleLine: true }` for one-line spots). An AI prompt given raw HTML can quote the tags back into its narrative.
- Emptiness: `isBlankRichText`, never `.trim() === ""`. An emptied editor returns `<p></p>`, and an abandoned bullet list `<ul><li><p></p></li></ul>`.
- Loading plain text into an editor goes through `toEditorHtml`, which turns line breaks into paragraphs. TipTap alone reads `"a\nb"` as HTML and saves it back as `"<p>a b</p>"`.
- Tests cannot type into TipTap with `fireEvent`. Page tests mock `@/components/RichTextEditor` as a textarea — and the mock must render the `footer` prop, because the action step's due date lives there.
- The email already routes all three through `richToEmailHtml` in `lib/observation-email.ts`.
