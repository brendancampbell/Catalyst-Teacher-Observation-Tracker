import { useState } from "react";
import { useUser } from "@/context/UserContext";
import { stopImpersonation } from "@/lib/api";

const BANNER_BG  = "#7c3aed";
const BANNER_TXT = "#ffffff";

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
        backgroundColor: BANNER_BG,
        color:           BANNER_TXT,
        padding:         "6px 16px",
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
      }}
    >
      <span style={{ opacity: 0.85 }}>👤</span>
      <span>
        Viewing as <strong>{currentUser.name}</strong>
        <span style={{ fontWeight: 400, opacity: 0.85 }}>
          {" "}({roleLabel}{school})
        </span>
        <span style={{ opacity: 0.7, fontWeight: 400 }}> — impersonated by {realUser.name}</span>
      </span>
      <button
        onClick={handleStop}
        disabled={stopping}
        style={{
          marginLeft:      8,
          padding:         "2px 12px",
          borderRadius:    4,
          border:          "1.5px solid rgba(255,255,255,0.5)",
          backgroundColor: "transparent",
          color:           BANNER_TXT,
          fontWeight:      700,
          fontSize:        12,
          cursor:          stopping ? "not-allowed" : "pointer",
          opacity:         stopping ? 0.6 : 1,
          whiteSpace:      "nowrap",
        }}
      >
        {stopping ? "Stopping…" : "Stop Impersonating"}
      </button>
    </div>
  );
}
