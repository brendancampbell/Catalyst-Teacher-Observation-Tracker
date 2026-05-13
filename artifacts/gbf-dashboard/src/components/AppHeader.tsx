import { Plus, Activity, ArrowLeft, ChevronDown, BookOpen } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import UserMenuDropdown from "./UserMenuDropdown";

const NAVY   = "#1034B4";
const YELLOW = "#FFB500";

interface RubricOption {
  slug: string;
  name: string;
}

interface AppHeaderProps {
  subtitle: string;
  backHref?: string;
  backLabel?: string;
  basePath: string;
  onAddObservation?: () => void;
  actionCenterHref: string;
  actionCenterLabel?: string;
  userName: string;
  userEmail?: string | null;
  userRole: string;
  canAdmin: boolean;
  rubricSets?: RubricOption[];
  activeRubricSet?: string;
  onRubricChange?: (slug: string) => void;
}

export default function AppHeader({
  subtitle,
  backHref,
  backLabel = "Dashboard",
  basePath,
  onAddObservation,
  actionCenterHref,
  actionCenterLabel = "Action Center",
  userName,
  userEmail,
  userRole,
  canAdmin,
  rubricSets,
  activeRubricSet,
  onRubricChange,
}: AppHeaderProps) {
  const [rubricOpen, setRubricOpen] = useState(false);
  const rubricRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rubricOpen) return;
    function handleClick(e: MouseEvent) {
      if (rubricRef.current && !rubricRef.current.contains(e.target as Node)) {
        setRubricOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [rubricOpen]);

  const activeRubricName = rubricSets?.find((r) => r.slug === activeRubricSet)?.name ?? activeRubricSet ?? "Rubric";

  return (
    <>
      <div style={{ height: 5, backgroundColor: YELLOW, flexShrink: 0 }} />
      <header style={{ backgroundColor: NAVY }} className="shrink-0">
        <div className="px-3 sm:px-5 py-2 sm:py-3 flex items-center justify-between gap-2">

          {/* ── Left: Logo + Title ── */}
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <a href={basePath} style={{ lineHeight: 0, display: "block", flexShrink: 0 }} aria-label="Go to dashboard">
              <img
                src="/uncommon-logo.png"
                alt="Uncommon Schools"
                className="h-6 sm:h-9 w-auto object-contain"
                style={{ filter: "brightness(0) invert(1)" }}
              />
            </a>
            <div className="hidden sm:block" style={{ width: 1, height: 30, backgroundColor: "rgba(255,181,0,0.45)" }} />
            <div className="hidden sm:block min-w-0">
              {backHref && (
                <a
                  href={backHref}
                  className="flex items-center gap-1 mb-0.5 transition-colors hover:text-yellow-300"
                  style={{ fontSize: 11, fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em", color: "rgba(147,197,253,0.9)", textDecoration: "none" }}
                >
                  <ArrowLeft size={11} />
                  {backLabel}
                </a>
              )}
              <p
                className="text-white uppercase tracking-widest leading-tight"
                style={{ fontFamily: "'Bebas Neue', sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: "0.04em" }}
              >
                Teacher Observation Tracker
              </p>
              <p className="text-blue-200 font-medium truncate" style={{ fontSize: 12 }}>
                {subtitle}
              </p>
            </div>
          </div>

          {/* ── Right: Actions ── */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">

            {/* ── Rubric Dropdown ── */}
            {rubricSets && rubricSets.length > 0 && onRubricChange && (
              <div ref={rubricRef} className="hidden sm:block relative">
                <button
                  type="button"
                  onClick={() => setRubricOpen((v) => !v)}
                  className="flex items-center rounded px-2 py-1.5 transition-colors hover:opacity-90"
                  style={{
                    backgroundColor: "rgba(255,255,255,0.1)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    color: "white",
                    outline: "none",
                  }}
                >
                  <div className="h-8 flex items-center gap-1.5">
                    <BookOpen size={15} style={{ color: YELLOW, flexShrink: 0 }} />
                    <span
                      className="font-bold uppercase"
                      style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 16, letterSpacing: "0.04em", color: YELLOW }}
                    >
                      {activeRubricName}
                    </span>
                    <ChevronDown
                      size={13}
                      strokeWidth={2.5}
                      style={{ color: "rgba(255,255,255,0.6)", transform: rubricOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
                    />
                  </div>
                </button>

                {rubricOpen && (
                  <div
                    className="absolute right-0 mt-2 rounded-lg shadow-xl z-50 overflow-hidden"
                    style={{ backgroundColor: "white", border: "1.5px solid #dde3f0", top: "100%", minWidth: 160 }}
                  >
                    <div className="px-3 py-2 border-b" style={{ borderColor: "#eef1fb", backgroundColor: "#f5f7ff" }}>
                      <p className="font-bold text-xs uppercase tracking-widest" style={{ color: NAVY, fontFamily: "'Bebas Neue', sans-serif", fontSize: 11, letterSpacing: "0.06em" }}>
                        Select Rubric
                      </p>
                    </div>
                    <div className="py-1">
                      {rubricSets.map((q) => {
                        const active = q.slug === activeRubricSet;
                        return (
                          <button
                            key={q.slug}
                            type="button"
                            onClick={() => { onRubricChange(q.slug); setRubricOpen(false); }}
                            className="w-full flex items-center gap-2.5 px-4 py-2 text-sm font-semibold transition-colors text-left"
                            style={{
                              backgroundColor: active ? "#f0f4ff" : "transparent",
                              color: active ? NAVY : "#374151",
                              fontFamily: "'Bebas Neue', sans-serif",
                              fontSize: 16,
                              letterSpacing: "0.03em",
                            }}
                          >
                            {q.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Action buttons grouped in one semi-transparent wrapper */}
            <div
              className="flex items-center gap-2 rounded px-2 py-1.5"
              style={{
                backgroundColor: "rgba(255,255,255,0.1)",
                border: "1px solid rgba(255,255,255,0.15)",
              }}
            >
              {onAddObservation && (
                <button
                  onClick={onAddObservation}
                  title="Add Observation"
                  className="w-8 h-8 flex items-center justify-center rounded transition-opacity hover:opacity-90 shrink-0"
                  style={{ backgroundColor: YELLOW, color: NAVY }}
                >
                  <Plus size={16} strokeWidth={3} />
                </button>
              )}

              <a
                href={actionCenterHref}
                className="hidden sm:flex w-8 h-8 items-center justify-center rounded transition-opacity hover:opacity-80 shrink-0"
                title={actionCenterLabel}
                style={{ backgroundColor: YELLOW, color: NAVY, textDecoration: "none" }}
              >
                <Activity size={15} />
              </a>
            </div>

            <UserMenuDropdown
              name={userName}
              email={userEmail}
              role={userRole}
              basePath={basePath}
              canAdmin={canAdmin}
            />
          </div>
        </div>
        <div style={{ height: 3, backgroundColor: YELLOW }} />
      </header>
    </>
  );
}
