import { useEffect, useState, useCallback } from "react";
import { decideEditorSync, toEditorHtml } from "@workspace/api-types";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Italic, List, ListOrdered, IndentDecrease, IndentIncrease, Maximize2, Minimize2 } from "lucide-react";

/* The box opens about three and a half lines tall and grows with what is
   written, up to five; past that it scrolls, rather than pushing the rest of
   the form down the page. 13px text at a line height of 1.6 is 20.8px a line,
   plus 8px of padding above and below. The phone's editor follows the same
   rule at its own text size. */
const LINE_PX     = 13 * 1.6;
const PADDING_PX  = 16;
const OPEN_HEIGHT = Math.round(3.5 * LINE_PX + PADDING_PX);
const MAX_HEIGHT  = Math.round(5 * LINE_PX + PADDING_PX);

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  focusBorderColor?: string;
  /** Height with the expand button on. The box holds that height and scrolls. */
  expandedHeight?: number;
  /** Announced by screen readers. A visible label beside the editor is not
      associated with it — there is no form control for it to point at. */
  ariaLabel?: string;
  /** Sets this box apart from the ones around it: a coloured left edge, and
      its toolbar and bottom bar tinted. */
  accent?: { color: string; tint: string; border: string };
  /** A bar along the bottom of the box, right-aligned, for a control that
      belongs to what is written in it — the action step's due date. */
  footer?: React.ReactNode;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  focusBorderColor = "#93c5fd",
  expandedHeight = 320,
  ariaLabel,
  accent,
  footer,
}: Props) {
  const [isExpanded, setIsExpanded] = useState(false);
  const minHeight = isExpanded ? expandedHeight : OPEN_HEIGHT;
  const maxHeight = isExpanded ? expandedHeight : MAX_HEIGHT;
  const editorHtml = toEditorHtml(value);

  /* Force a re-render on every editor transaction so toolbar active-states
     (bold, italic, list) update immediately — including when no text is
     selected and the user just toggles a mark at the cursor position.      */
  const [, forceUpdate] = useState(0);
  const handleTransaction = useCallback(() => forceUpdate((n) => n + 1), []);

  const editorStyle = (height: number) =>
    `min-height:${height}px;outline:none;padding:8px 12px;font-size:13px;line-height:1.6;`;

  const editor = useEditor({
    extensions: [StarterKit],
    content: editorHtml,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    onTransaction: handleTransaction,
    editorProps: {
      attributes: {
        style: editorStyle(minHeight),
        role: "textbox",
        "aria-multiline": "true",
        ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
      },
    },
  });

  /* Sync min-height when expand state changes */
  useEffect(() => {
    if (!editor) return;
    editor.view.dom.setAttribute("style", editorStyle(minHeight));
  }, [minHeight, editor]);

  /* Keep the editor in step with `value` after creation.
     TipTap applies `content` only when the editor is built, so a value that
     arrives later — a resumed draft, most importantly — never reached it. See
     decideEditorSync for why this cannot simply write on every change. */
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
      /* emitUpdate false: this is the parent's own value coming back in, and
         announcing it as an edit would loop straight back here. */
      editor.commands.setContent(editorHtml, { emitUpdate: false });
    }
  }, [editorHtml, editor]);

  if (!editor) return null;

  const btn = (active: boolean, onClick: () => void, title: string, children: React.ReactNode) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className="flex items-center justify-center w-7 h-7 rounded transition-colors"
      style={{
        backgroundColor: active ? "#e0e7ff" : "transparent",
        color: active ? "#3730a3" : "#475569",
      }}
    >
      {children}
    </button>
  );

  const barBackground = accent?.tint ?? "#f8fafc";
  const barBorder     = accent?.border ?? "#f1f5f9";

  return (
    <div
      className="rounded border bg-white overflow-hidden transition-shadow focus-within:ring-2"
      style={{
        borderColor: accent?.border ?? "#e2e8f0",
        ...(accent ? { borderLeftWidth: 4, borderLeftColor: accent.color } : {}),
        ["--tw-ring-color" as string]: focusBorderColor,
      }}
    >
      {/* Toolbar */}
      <div
        className="flex items-center gap-0.5 px-2 py-1 border-b"
        style={{ borderColor: barBorder, backgroundColor: barBackground }}
      >
        {btn(editor.isActive("bold"),    () => editor.chain().focus().toggleBold().run(),        "Bold",           <Bold size={13} strokeWidth={2.5} />)}
        {btn(editor.isActive("italic"),  () => editor.chain().focus().toggleItalic().run(),      "Italic",         <Italic size={13} strokeWidth={2} />)}
        <div style={{ width: 1, height: 18, backgroundColor: "#e2e8f0", margin: "0 4px" }} />
        {btn(editor.isActive("bulletList"),  () => editor.chain().focus().toggleBulletList().run(),  "Bullet list",    <List size={14} strokeWidth={2} />)}
        {btn(editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), "Numbered list",  <ListOrdered size={14} strokeWidth={2} />)}
        <div style={{ width: 1, height: 18, backgroundColor: "#e2e8f0", margin: "0 4px" }} />
        {btn(false, () => editor.chain().focus().liftListItem("listItem").run(),  "Outdent", <IndentDecrease size={14} strokeWidth={2} />)}
        {btn(false, () => editor.chain().focus().sinkListItem("listItem").run(),  "Indent",  <IndentIncrease size={14} strokeWidth={2} />)}

        {/* Spacer + expand toggle */}
        <div style={{ flex: 1 }} />
        <button
          type="button"
          title={isExpanded ? "Collapse" : "Expand editor"}
          onMouseDown={(e) => { e.preventDefault(); setIsExpanded((v) => !v); }}
          className="flex items-center justify-center w-7 h-7 rounded transition-colors"
          style={{ color: "#94a3b8" }}
        >
          {isExpanded
            ? <Minimize2 size={13} strokeWidth={2} />
            : <Maximize2 size={13} strokeWidth={2} />}
        </button>
      </div>

      {/* Editor area — grows to the cap, then scrolls */}
      <div
        className="relative overflow-y-auto transition-[min-height,max-height] duration-200 ease-in-out"
        style={{ minHeight, maxHeight }}
      >
        {editor.isEmpty && !editor.isActive("bulletList") && !editor.isActive("orderedList") && placeholder && (
          <p
            className="absolute top-0 left-0 pointer-events-none select-none"
            style={{ padding: "8px 12px", fontSize: 13, color: "#94a3b8" }}
          >
            {placeholder}
          </p>
        )}
        <EditorContent editor={editor} />
      </div>

      {footer && (
        <div
          className="flex flex-wrap items-center justify-end gap-2 px-2 py-1.5 border-t"
          style={{ borderColor: barBorder, backgroundColor: barBackground }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
