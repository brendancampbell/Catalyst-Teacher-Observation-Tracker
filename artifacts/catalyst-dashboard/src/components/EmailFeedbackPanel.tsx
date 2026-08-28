import { useState, useMemo } from "react";
import {
  buildEmailPlainText, buildEmailHtml,
  applicableSections, defaultSections, normaliseSections, SECTION_LABELS,
  type EmailSource, type EmailSections,
} from "@/lib/observation-email";

const NAVY = "#1034B4";

interface Props {
  src:            EmailSource;
  /** The opening paragraph, glows and grows as first offered. All three stay
      editable here and none of it touches the observation — this composes an
      email, it does not rewrite the record. */
  initialIntro:   string;
  initialGlows:   string;
  initialGrows:   string;
  onClose:        () => void;
}

/**
 * The email, previewed and ready to copy.
 *
 * Shown in two places and identical in both: straight after an observation is
 * filed, and later from the observation itself when it needs sending again.
 * Catalyst sends nothing — this hands the observer a formatted email to paste,
 * or opens Outlook with it.
 */
export function EmailFeedbackPanel({ src, initialIntro, initialGlows, initialGrows, onClose }: Props) {
  const [editableIntro,   setEditableIntro]   = useState(initialIntro);
  const [editableGlows]   = useState(initialGlows);
  const [editableGrows]   = useState(initialGrows);
  /* Fresh on every email. A choice made weeks ago should not quietly shape
     what a teacher receives today. */
  const applicable = useMemo(() => applicableSections(src), [src]);
  const [sections, setSections] = useState<EmailSections>(() => defaultSections(src));

  function toggle(key: keyof EmailSections) {
    setSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  /* What the email actually gets. The unscored rows cannot travel without the
     scored ones; the raw choice is kept rather than cleared, so turning the
     scored rows back on restores the sub-choice instead of losing it. */
  const effective = useMemo(() => normaliseSections(sections), [sections]);
  const [emailTab,        setEmailTab]        = useState<"preview" | "edit">("edit");
  const [copiedHtml,      setCopiedHtml]      = useState(false);

  const liveHtmlEmail = useMemo(
    () => buildEmailHtml(src, editableIntro, editableGlows, editableGrows, effective),
    [src, editableIntro, editableGlows, editableGrows, sections],
  );
  const livePlainBody = useMemo(
    () => buildEmailPlainText(src, editableIntro, effective).body,
    [src, editableIntro, sections],
  );

  async function writeRichHtmlToClipboard(html: string): Promise<void> {
    const plain = livePlainBody || html.replace(/<[^>]+>/g, "");

    // 1. Modern Clipboard API — writes both text/html and text/plain
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html":  new Blob([html],  { type: "text/html"  }),
            "text/plain": new Blob([plain], { type: "text/plain" }),
          }),
        ]);
        return;
      } catch { /* fall through */ }
    }

    // 2. contenteditable + execCommand — copies rendered DOM so rich formatting is preserved
    try {
      const div = document.createElement("div");
      div.contentEditable = "true";
      div.innerHTML = html;
      Object.assign(div.style, {
        position: "fixed", top: "0", left: "0",
        width: "1px", height: "1px",
        opacity: "0", pointerEvents: "none", overflow: "hidden",
      });
      document.body.appendChild(div);
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(div);
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.execCommand("copy");
      sel?.removeAllRanges();
      document.body.removeChild(div);
      return;
    } catch { /* fall through */ }

    // 3. Last resort — raw HTML markup as plain text
    await navigator.clipboard.writeText(html);
  }

  async function handleCopyHtml(html: string) {
    try { await writeRichHtmlToClipboard(html); } catch { /* ignore */ }
    setCopiedHtml(true);
    setTimeout(() => setCopiedHtml(false), 3500);
  }

  return (
    <>
              <div className="overflow-y-auto flex-1 flex flex-col gap-3 px-6 py-4" style={{ fontFamily: "'Libre Franklin', sans-serif" }}>

                {/* Header row */}
                <div className="flex items-center justify-between gap-3 shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">✉</span>
                    <div>
                      <p className="font-bold text-slate-700 text-sm leading-snug">Observation saved!</p>
                      <p className="text-slate-500 text-xs mt-0.5 leading-snug">Edit the opening below, then copy or send in Outlook.</p>
                    </div>
                  </div>
                  {/* Edit / Preview tabs */}
                  <div className="flex rounded overflow-hidden border shrink-0" style={{ borderColor: NAVY }}>
                    {(["edit", "preview"] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setEmailTab(tab)}
                        className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors"
                        style={{
                          backgroundColor: emailTab === tab ? NAVY : "white",
                          color: emailTab === tab ? "white" : NAVY,
                        }}
                      >
                        {tab === "edit" ? "Edit Opening" : "Preview"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Edit tab — subject + opening only */}
                {emailTab === "edit" && (
                  <div className="flex flex-col gap-4 flex-1">
                    {/* One row rather than a stacked list. Five ticked lines
                        pushed the opening message off the bottom of a laptop
                        screen, and this is a setting people glance at, not a
                        form they fill in.

                        The two rubric choices sit in one bordered group so the
                        second reads as part of the first — the dependency the
                        indent used to carry. */}
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                        Include in Email
                      </label>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {SECTION_LABELS.map(({ key, label, underScoredRows }) => {
                          /* Shown either way. A chip that vanished when it had
                             nothing behind it would leave people hunting for an
                             option that was never there. */
                          const present = applicable[key];
                          const blocked = !!underScoredRows && !sections.scoredRows;
                          const enabled = present && !blocked;
                          const on      = enabled && effective[key];
                          return (
                            <button
                              key={key}
                              type="button"
                              onClick={() => enabled && toggle(key)}
                              disabled={!enabled}
                              aria-pressed={on}
                              title={
                                !present ? "Nothing of this kind on this observation"
                                : blocked ? "Include the scored rows first"
                                : undefined
                              }
                              className={[
                                "flex items-center gap-1.5 rounded-full text-xs font-semibold transition-colors",
                                "px-3 py-1.5 border",
                                underScoredRows ? "-ml-1 rounded-l-none border-l-0" : "",
                                enabled ? "cursor-pointer" : "cursor-not-allowed opacity-60",
                              ].join(" ")}
                              style={{
                                backgroundColor: on ? NAVY : "white",
                                borderColor:     on ? NAVY : "#dde3f0",
                                color:           on ? "white" : enabled ? "#475569" : "#94a3b8",
                              }}
                            >
                              <span aria-hidden className="text-[13px] leading-none">
                                {on ? "✓" : "＋"}
                              </span>
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex-1 flex flex-col">
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                        Opening Message (Salutation, Body &amp; Signature)
                      </label>
                      <textarea
                        value={editableIntro}
                        onChange={(e) => setEditableIntro(e.target.value)}
                        className="w-full flex-1 px-3 py-2 rounded border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white resize-none"
                        style={{ fontFamily: "'Libre Franklin', sans-serif", minHeight: 180 }}
                      />
                    </div>
                  </div>
                )}

                {/* Preview tab — rendered iframe */}
                {emailTab === "preview" && (
                  <div className="flex-1 flex flex-col min-h-0">
                    <iframe
                      srcDoc={liveHtmlEmail}
                      className="w-full rounded border border-slate-200 bg-white flex-1"
                      style={{ minHeight: 320 }}
                      title="Email Preview"
                      sandbox="allow-same-origin"
                    />
                  </div>
                )}

              </div>

              {/* Footer */}
              <style>{`
                @keyframes catalystFadeOut {
                  0%   { opacity: 1; }
                  60%  { opacity: 1; }
                  100% { opacity: 0; }
                }
                .catalyst-copy-notif { animation: catalystFadeOut 3.5s forwards; }
              `}</style>
              <div className="shrink-0 px-4 sm:px-6 py-3 border-t border-slate-200 bg-slate-50">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    {copiedHtml && (
                      <p className="catalyst-copy-notif text-sm font-semibold text-green-700 truncate">
                        Email Copied — Paste (Ctrl+V) into a new email message.
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopyHtml(liveHtmlEmail)}
                    className="shrink-0 px-5 py-2 rounded text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm"
                    style={{ backgroundColor: NAVY }}
                  >
                    Copy Email
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="shrink-0 px-5 py-2 rounded text-sm font-semibold border border-slate-300 text-slate-600 hover:bg-slate-100 transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
    </>
  );
}
