import { useEffect, useState, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Italic, List, ListOrdered, IndentDecrease, IndentIncrease } from "lucide-react";
import { decideEditorSync, toEditorHtml } from "@workspace/api-types";

/*
 * The phone's copy of the dashboard's RichTextEditor: the same toolbar, the
 * same stored HTML, and the same rules for when a value is written back in
 * (decideEditorSync, shared). The two apps share no components, so keep them
 * in step by hand.
 *
 * The differences are for fingers and a narrow screen — bigger buttons, 14px
 * text, no expand button — and a red outline for a box that must be filled in.
 */

/* Opens about three and a half lines tall and grows with what is written, up
   to five; past that it scrolls. 14px text at a line height of 1.6 is 22.4px a
   line, plus 10px of padding above and below. */
const LINE_PX     = 14 * 1.6;
const PADDING_PX  = 20;
const OPEN_HEIGHT = Math.round(3.5 * LINE_PX + PADDING_PX);
const MAX_HEIGHT  = Math.round(5 * LINE_PX + PADDING_PX);
const EDITOR_STYLE =
  `min-height:${OPEN_HEIGHT}px;outline:none;padding:10px 12px;font-size:14px;line-height:1.6;color:#1e293b;`;

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  focusBorderColor?: string;
  /** Announced by screen readers; the visible label is not associated with it. */
  ariaLabel?: string;
  /** Sets this box apart: a coloured left edge, and its bars tinted. */
  accent?: { color: string; tint: string; border: string };
  /** A bar along the bottom of the box, right-aligned — the action step's due date. */
  footer?: React.ReactNode;
  /** Outlines the box in red when it needs filling in. */
  invalid?: boolean;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  focusBorderColor = "#93c5fd",
  ariaLabel,
  accent,
  footer,
  invalid = false,
}: Props) {
  const editorHtml = toEditorHtml(value);

  /* Re-render on every transaction so the toolbar's active states keep up. */
  const [, forceUpdate] = useState(0);
  const handleTransaction = useCallback(() => forceUpdate((n) => n + 1), []);

  const editor = useEditor({
    extensions: [StarterKit],
    content: editorHtml,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    onTransaction: handleTransaction,
    editorProps: {
      attributes: {
        style: EDITOR_STYLE,
        role: "textbox",
        "aria-multiline": "true",
        ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
      },
    },
  });

  /* A value that arrives after the editor is built — a restored draft — has
     to be written in; see decideEditorSync for why not on every change. */
  useEffect(() => {
    if (!editor) return;
    const action = decideEditorSync({
      incoming:        editorHtml,
      currentHtml:     editor.getHTML(),
      editorIsEmpty:   editor.isEmpty,
      editorIsFocused: editor.isFocused,
    });
    if (action === "clear") {
      editor.commands.clearContent(false);
    } else if (action === "replace") {
      editor.commands.setContent(editorHtml, { emitUpdate: false });
    }
  }, [editorHtml, editor]);

  if (!editor) return null;

  const btn = (active: boolean, run: () => void, title: string, icon: React.ReactNode) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      /* Keeps the caret in the text: without it the tap moves focus to the
         button and the keyboard drops before the command runs. */
      onPointerDown={(e) => e.preventDefault()}
      onClick={run}
      className="flex items-center justify-center w-9 h-9 rounded-md transition-colors"
      style={{
        backgroundColor: active ? "#e0e7ff" : "transparent",
        color: active ? "#3730a3" : "#475569",
      }}
    >
      {icon}
    </button>
  );

  const barBackground = accent?.tint ?? "#f8fafc";
  const barBorder     = accent?.border ?? "#f1f5f9";
  const divider = <div style={{ width: 1, height: 20, backgroundColor: "#e2e8f0", margin: "0 4px" }} />;

  return (
    <div
      className="rounded-lg border bg-white overflow-hidden transition-shadow focus-within:ring-2"
      style={{
        borderColor: invalid ? "#f87171" : accent?.border ?? "#e2e8f0",
        ...(accent ? { borderLeftWidth: 4, borderLeftColor: accent.color } : {}),
        ["--tw-ring-color" as string]: focusBorderColor,
      }}
    >
      <div
        className="flex items-center gap-0.5 px-1.5 py-1 border-b"
        style={{ borderColor: barBorder, backgroundColor: barBackground }}
      >
        {btn(editor.isActive("bold"),        () => editor.chain().focus().toggleBold().run(),        "Bold",          <Bold size={16} strokeWidth={2.5} />)}
        {btn(editor.isActive("italic"),      () => editor.chain().focus().toggleItalic().run(),      "Italic",        <Italic size={16} strokeWidth={2} />)}
        {divider}
        {btn(editor.isActive("bulletList"),  () => editor.chain().focus().toggleBulletList().run(),  "Bullet list",   <List size={17} strokeWidth={2} />)}
        {btn(editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), "Numbered list", <ListOrdered size={17} strokeWidth={2} />)}
        {divider}
        {btn(false, () => editor.chain().focus().liftListItem("listItem").run(), "Outdent", <IndentDecrease size={17} strokeWidth={2} />)}
        {btn(false, () => editor.chain().focus().sinkListItem("listItem").run(), "Indent",  <IndentIncrease size={17} strokeWidth={2} />)}
      </div>

      <div className="relative overflow-y-auto" style={{ minHeight: OPEN_HEIGHT, maxHeight: MAX_HEIGHT }}>
        {editor.isEmpty && !editor.isActive("bulletList") && !editor.isActive("orderedList") && placeholder && (
          <p
            className="absolute top-0 left-0 pointer-events-none select-none"
            style={{ padding: "10px 12px", fontSize: 14, color: "#94a3b8" }}
          >
            {placeholder}
          </p>
        )}
        <EditorContent editor={editor} />
      </div>

      {footer && (
        <div
          className="flex flex-wrap items-center justify-end gap-2 px-3 py-2 border-t"
          style={{ borderColor: barBorder, backgroundColor: barBackground }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
