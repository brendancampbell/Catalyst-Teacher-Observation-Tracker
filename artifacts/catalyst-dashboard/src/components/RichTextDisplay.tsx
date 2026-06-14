import DOMPurify from "dompurify";

/** Renders stored glows/grows content — handles both old plain-text and new HTML from TipTap. */
export function RichTextDisplay({
  content,
  className = "",
  emptyNode,
}: {
  content: string | null | undefined;
  className?: string;
  emptyNode?: React.ReactNode;
}) {
  if (!content?.trim()) return <>{emptyNode ?? null}</>;

  const isHtml = /<[a-z][\s\S]*>/i.test(content);
  const rawHtml = isHtml
    ? content
    : content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");

  const safeHtml = DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: ["p", "br", "strong", "em", "ul", "ol", "li", "b", "i", "u", "s", "blockquote"],
    ALLOWED_ATTR: [],
  });

  return (
    <div
      className={`text-sm leading-relaxed [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-1 [&_li]:my-0.5 [&_strong]:font-bold [&_em]:italic ${className}`}
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}
