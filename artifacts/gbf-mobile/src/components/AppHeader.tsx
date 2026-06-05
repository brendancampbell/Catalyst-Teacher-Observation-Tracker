import React from "react";
import { useAuth } from "@/context/AuthContext";
import { LogOut, ArrowLeftRight } from "lucide-react";

const NAVY = "#1034B4";
const YELLOW = "#FFB500";

interface AppHeaderProps {
  subtitle?: string;
  onSwitchSchool?: () => void;
}

export function AppHeader({ subtitle, onSwitchSchool }: AppHeaderProps) {
  const { signOut } = useAuth();

  return (
    <header>
      <div style={{ height: 5, backgroundColor: YELLOW }} />
      <div style={{ backgroundColor: NAVY }} className="px-4 py-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p
            className="text-white uppercase leading-none"
            style={{ fontFamily: "'Bebas Neue', sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: "0.04em" }}
          >
            Catalyst
          </p>
          <p
            className="text-blue-200 uppercase leading-tight"
            style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 11, letterSpacing: "0.05em" }}
          >
            Teacher Observation Tool
          </p>
          {subtitle && (
            <p className="text-blue-200 truncate" style={{ fontSize: 13 }}>{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onSwitchSchool && (
            <button
              onClick={onSwitchSchool}
              className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-bold transition-opacity hover:opacity-80"
              style={{
                border: "1.5px solid rgba(255,181,0,0.5)",
                color: YELLOW,
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 13,
                letterSpacing: "0.04em",
              }}
            >
              <ArrowLeftRight size={12} />
              Switch School
            </button>
          )}
          <button
            onClick={signOut}
            className="p-1.5 text-blue-300 hover:text-white transition-colors rounded"
            title="Sign out"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>
      <div style={{ height: 3, backgroundColor: YELLOW }} />
    </header>
  );
}
