import { useState } from "react";
import { useUser } from "@/context/UserContext";
import { stopImpersonation } from "@/lib/api";

const NAVY   = "#1034B4";
const YELLOW = "#FFB500";

const ALL_ROLES_MAP: Record<string, string> = {
  COACH:          "Coach",
  SCHOOL_LEADER:  "School Leader",
  NETWORK_LEADER: "Network Leader",
  NETWORK_ADMIN:  "Network Admin",
};

export default function ImpersonationBanner() {
  const { isImpersonating, realUser, currentUser, refetch } = useUser();
  const [stopping, setStopping] = useState(false);

  if (!isImpersonating || !currentUser || !realUser) return null;

  const roleLabel = ALL_ROLES_MAP[currentUser.role] ?? currentUser.role;
  const school    = currentUser.schoolName ? ` · ${currentUser.schoolName}` : "";

  async function handleStop() {
    setStopping(true);
    try {
      await stopImpersonation();
      await refetch();
      window.location.href = "/";
    } catch {
      setStopping(false);
    }
  }

  return (
    <div
      style={{
        backgroundColor: NAVY,
        borderBottom:    `3px solid ${YELLOW}`,
        color:           "#ffffff",
        padding:         "5px 16px",
        display:         "flex",
        alignItems:      "center",
        justifyContent:  "center",
        gap:             12,
        fontSize:        13,
        fontWeight:      600,
        position:        "sticky",
        top:             0,
        zIndex:          9999,
        flexShrink:      0,
        fontFamily:      "'Libre Franklin', sans-serif",
      }}
    >
      <span
        style={{
          fontFamily:    "'Bebas Neue', sans-serif",
          fontSize:      14,
          letterSpacing: "0.06em",
          color:         YELLOW,
          whiteSpace:    "nowrap",
        }}
      >
        VIEWING AS
      </span>

      <span style={{ color: YELLOW, fontWeight: 700 }}>{currentUser.name}</span>

      <span style={{ color: "rgba(255,255,255,0.65)", fontWeight: 400, whiteSpace: "nowrap" }}>
        {roleLabel}{school}
      </span>

      <span style={{ color: "rgba(255,181,0,0.4)" }}>|</span>

      <span style={{ color: "rgba(255,255,255,0.55)", fontWeight: 400, fontSize: 12, whiteSpace: "nowrap" }}>
        Impersonated by {realUser.name}
      </span>

      <button
        onClick={handleStop}
        disabled={stopping}
        style={{
          marginLeft:      4,
          padding:         "3px 14px",
          borderRadius:    4,
          border:          `1.5px solid ${YELLOW}`,
          backgroundColor: "transparent",
          color:           YELLOW,
          fontFamily:      "'Bebas Neue', sans-serif",
          fontWeight:      700,
          fontSize:        13,
          letterSpacing:   "0.04em",
          cursor:          stopping ? "not-allowed" : "pointer",
          opacity:         stopping ? 0.6 : 1,
          whiteSpace:      "nowrap",
          transition:      "background-color 0.15s",
        }}
        onMouseEnter={(e) => { if (!stopping) e.currentTarget.style.backgroundColor = "rgba(255,181,0,0.15)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
      >
        {stopping ? "Stopping…" : "Stop Impersonating"}
      </button>
    </div>
  );
}
