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
        <div className="px-3 sm:px-5 py-3 sm:py-4 flex items-center justify-between gap-2">

          {/* ── Left: Logo + Title ── */}
          <div className="flex items-center gap-3 sm:gap-5 min-w-0">
            <a href={basePath} style={{ lineHeight: 0, display: "block", flexShrink: 0 }} aria-label="Go to dashboard">
              <img
                src="/uncommon-logo.png"
                alt="Uncommon Schools"
                className="h-8 sm:h-12 w-auto object-contain"
                style={{ filter: "brightness(0) invert(1)" }}
              />
            </a>
            <div className="hidden sm:block" style={{ width: 1, height: 40, backgroundColor: "rgba(255,181,0,0.45)" }} />
            <div className="hidden sm:block min-w-0">
              {backHref && (
                <a
                  href={backHref}
                  className="flex items-center gap-1 mb-0.5 transition-colors hover:text-yellow-300"
                  style={{ fontSize: 12, fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em", color: "rgba(147,197,253,0.9)", textDecoration: "none" }}
                >
                  <ArrowLeft size={12} />
                  {backLabel}
                </a>
              )}
              <p
                className="text-white uppercase tracking-widest leading-tight"
                style={{ fontFamily: "'Bebas Neue', sans-serif", fontWeight: 700, fontSize: 30, letterSpacing: "0.04em" }}
              >
                Teacher Observation Tracker
              </p>
              <p className="text-blue-200 font-medium truncate" style={{ fontSize: 15 }}>
                {subtitle}
              </p>
            </div>
          </div>

          {/* ── Right: Actions ── */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {onAddObservation && (
              <button
                onClick={onAddObservation}
                className="flex items-center gap-1.5 font-bold rounded-md px-3 sm:px-4 py-2 transition-opacity hover:opacity-90 shadow-sm"
                style={{
                  backgroundColor: YELLOW,
                  color: NAVY,
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 15,
                  letterSpacing: "0.02em",
                }}
              >
                <Plus size={16} strokeWidth={3} />
                <span className="hidden sm:inline">Add Observation</span>
              </button>
            )}

            <a
              href={actionCenterHref}
              className="hidden sm:flex items-center gap-1.5 font-bold rounded-md px-3 py-2 transition-opacity hover:opacity-80"
              style={{
                border: "1.5px solid rgba(255,181,0,0.5)",
                color: YELLOW,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 14,
                letterSpacing: "0.02em",
                textDecoration: "none",
              }}
            >
              <Activity size={14} />
              {actionCenterLabel}
            </a>

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
