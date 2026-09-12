/**
 * Glows, grows and action steps are written in the dashboard's rich-text
 * editor, so what is stored is HTML — or, for anything written before the
 * editor existed or typed on the phone, plain text. Both are live in the data.
 *
 * Most places render that HTML (sanitised). These are for the places that
 * cannot: a one-line table cell, a hover title, a plain phone text box, and
 * the text handed to the AI, where "<p><strong>" is noise it may repeat back.
 */

/** The same test RichTextDisplay uses to decide whether to render as HTML. */
export function looksLikeRichText(value: string): boolean {
  return /<[a-z][\s\S]*>/i.test(value);
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
};

/* One pass, so "&amp;lt;" becomes "&lt;" and stops there rather than being
   decoded a second time into "<". */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith("#")) {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/**
 * Stored rich text as readable plain text: one line per paragraph, list items
 * as "• " lines. Bold and italics have no plain spelling and are dropped.
 *
 * Plain text passes through untouched, apart from `singleLine`, which joins
 * the lines with spaces for places that only have room for one.
 */
export function richTextToPlainText(
  value: string | null | undefined,
  options: { singleLine?: boolean } = {},
): string {
  if (!value) return "";

  if (!looksLikeRichText(value)) {
    return options.singleLine
      ? value.split(/\s*\n\s*/).filter(Boolean).join(" ").trim()
      : value;
  }

  const text = decodeEntities(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n• ")
      .replace(/<\/(p|li|ul|ol|blockquote|div)>/gi, "\n")
      .replace(/<[^>]*>/g, ""),
  );

  const lines = text
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    /* An empty bullet is what the editor leaves after a list is started and
       abandoned — nothing anybody wrote. */
    .filter((line) => line !== "" && line !== "•");

  return lines.join(options.singleLine ? " " : "\n");
}

/**
 * True when there are no words in it. The editor never hands back "" once it
 * has been touched — an emptied box is "<p></p>", and an abandoned list is
 * "<ul><li><p></p></li></ul>" — so a `.trim()` check lets both through as
 * though something had been written.
 */
export function isBlankRichText(value: string | null | undefined): boolean {
  return richTextToPlainText(value).replace(/^•\s*/gm, "").trim() === "";
}
