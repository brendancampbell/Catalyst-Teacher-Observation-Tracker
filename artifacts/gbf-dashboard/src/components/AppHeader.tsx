import { Plus, Activity, ArrowLeft } from "lucide-react";
import UserMenuDropdown from "./UserMenuDropdown";

const NAVY   = "#1034B4";
const YELLOW = "#FFB500";

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
}: AppHeaderProps) {
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
