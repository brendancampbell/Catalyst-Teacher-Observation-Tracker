import { useEffect, useRef, useState } from "react";
import { ChevronDown, Settings, LogOut } from "lucide-react";

const NAVY   = "#1034B4";
const YELLOW = "#FFB500";

interface Props {
  name:      string;
  email?:    string | null;
  role:      string;
  basePath:  string;
  canAdmin:  boolean;
}

export default function UserMenuDropdown({ name, email, role, basePath, canAdmin }: Props) {
  const [open, setOpen]  = useState(false);
  const ref              = useRef<HTMLDivElement>(null);

  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("");

  const roleLabel = role.replace(/_/g, " ");

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", onOutsideClick);
    return () => document.removeEventListener("mousedown", onOutsideClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {/* ── Trigger ── */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded px-2 sm:px-3 py-1.5 transition-colors"
        style={{
          backgroundColor: "rgba(255,255,255,0.1)",
          border: "1px solid rgba(255,255,255,0.15)",
          color: "white",
          outline: "none",
        }}
      >
        {/* Avatar */}
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
          style={{ backgroundColor: YELLOW, color: NAVY }}
        >
          {initials}
        </div>

        {/* Name */}
        <span className="font-medium hidden sm:block" style={{ fontSize: 15 }}>{name}</span>

        <ChevronDown
          size={14}
          strokeWidth={2.5}
          className="shrink-0 transition-transform"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", color: "rgba(255,255,255,0.6)" }}
        />
      </button>

      {/* ── Dropdown panel ── */}
      {open && (
        <div
          className="absolute right-0 mt-2 w-44 rounded-lg shadow-xl z-50 overflow-hidden"
          style={{
            backgroundColor: "white",
            border: "1.5px solid #dde3f0",
            top: "100%",
          }}
        >
          {/* User info header */}
          <div
            className="px-4 py-3 border-b"
            style={{ borderColor: "#eef1fb", backgroundColor: "#f5f7ff" }}
          >
            <p className="font-bold text-sm truncate" style={{ color: NAVY }}>{name}</p>
            {email && <p className="text-xs font-medium truncate" style={{ color: "#6b7280" }}>{email}</p>}
            <p className="text-xs font-medium truncate" style={{ color: "#94a3b8" }}>{roleLabel}</p>
          </div>

          {/* Menu items */}
          <div className="py-1">
            {canAdmin && (
              <a
                href={`${basePath}/admin`}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-blue-50"
                style={{ color: NAVY, textDecoration: "none" }}
              >
                <Settings size={14} strokeWidth={2} />
                Settings
              </a>
            )}

            <form method="POST" action={`${basePath}/api/auth/logout`}>
              <button
                type="submit"
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-red-50 text-left"
                style={{ color: "#dc2626" }}
              >
                <LogOut size={14} strokeWidth={2} />
                Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
