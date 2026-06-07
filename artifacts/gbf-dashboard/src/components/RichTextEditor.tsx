import { useEffect, useState, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Italic, List, ListOrdered, IndentDecrease, IndentIncrease, Maximize2, Minimize2 } from "lucide-react";

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  focusBorderColor?: string;
  minHeight?: number;
  expandedHeight?: number;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  focusBorderColor = "#93c5fd",
  minHeight = 100,
  expandedHeight = 320,
}: Props) {
  const [isExpanded, setIsExpanded] = useState(false);
  const effectiveMinHeight = isExpanded ? expandedHeight : minHeight;

  /* Force a re-render on every editor transaction so toolbar active-states
     (bold, italic, list) update immediately — including when no text is
     selected and the user just toggles a mark at the cursor position.      */
  const [, forceUpdate] = useState(0);
  const handleTransaction = useCallback(() => forceUpdate((n) => n + 1), []);

  const editor = useEditor({
    extensions: [StarterKit],
    content: value || "",
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    onTransaction: handleTransaction,
    editorProps: {
      attributes: {
        style: `min-height:${effectiveMinHeight}px;outline:none;padding:8px 12px;font-size:13px;line-height:1.6;`,
      },
    },
  });

  /* Sync min-height when expand state changes */
  useEffect(() => {
    if (!editor) return;
    editor.view.dom.setAttribute(
      "style",
      `min-height:${effectiveMinHeight}px;outline:none;padding:8px 12px;font-size:13px;line-height:1.6;`,
    );
  }, [effectiveMinHeight, editor]);

  useEffect(() => {
    if (!editor) return;
    const isEmpty = !value || value === "<p></p>";
    const currentEmpty = editor.isEmpty;
    if (isEmpty && !currentEmpty) {
      editor.commands.clearContent(false);
    }
  }, [value, editor]);

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

  return (
    <div
      className="rounded border bg-white overflow-hidden transition-shadow focus-within:ring-2"
      style={{
        borderColor: "#e2e8f0",
        ["--tw-ring-color" as string]: focusBorderColor,
      }}
    >
      {/* Toolbar */}
      <div
        className="flex items-center gap-0.5 px-2 py-1 border-b"
        style={{ borderColor: "#f1f5f9", backgroundColor: "#f8fafc" }}
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

      {/* Editor area — smooth height transition */}
      <div
        className="relative transition-[min-height] duration-200 ease-in-out"
        style={{ minHeight: effectiveMinHeight }}
      >
        {editor.isEmpty && placeholder && (
          <p
            className="absolute top-0 left-0 pointer-events-none select-none"
            style={{ padding: "8px 12px", fontSize: 13, color: "#94a3b8" }}
          >
            {placeholder}
          </p>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
