import React, { useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useApp } from "@/context/AppContext";
import { AppHeader } from "@/components/AppHeader";
import { apiFetch, School } from "@/lib/api";
import { ChevronRight, School as SchoolIcon, AlertCircle, Loader2 } from "lucide-react";

const NAVY = "#1034B4";
const YELLOW = "#FFB500";

export default function SchoolPickerPage() {
  const { user } = useAuth();
  const { setSelectedSchool } = useApp();
  const [, navigate] = useLocation();

  const isNetworkScope = user?.role === "NETWORK_ADMIN" || user?.role === "NETWORK_LEADER";

  useEffect(() => {
    if (!user) {
      navigate("/");
    } else if (!isNetworkScope) {
      navigate("/rubric-picker");
    }
  }, [user, isNetworkScope]);

  const { data: schools, isLoading, isError, refetch } = useQuery<School[]>({
    queryKey: ["schools"],
    queryFn: () => apiFetch<School[]>("/api/admin/schools"),
    enabled: !!user,
  });

  function handleSelect(school: School) {
    setSelectedSchool(school);
    navigate("/rubric-picker");
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <AppHeader subtitle="Select a School" />

      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pt-5 pb-4">
          <h2 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: NAVY, letterSpacing: "0.04em" }}>
            Schools
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">Choose the school you will observe today</p>
        </div>

        {isLoading && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 size={28} className="animate-spin" style={{ color: NAVY }} />
            <p className="text-sm text-slate-500">Loading schools…</p>
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 px-6 text-center">
            <AlertCircle size={32} className="text-red-400" />
            <p className="text-sm font-semibold text-red-500">Failed to load schools</p>
            <button
              onClick={() => refetch()}
              className="px-5 py-2 rounded-lg text-sm font-semibold text-white"
              style={{ backgroundColor: NAVY }}
            >
              Retry
            </button>
          </div>
        )}

        {!isLoading && !isError && schools && (
          <div className="px-4 pb-6 flex flex-col gap-2.5">
            {schools.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
                <SchoolIcon size={32} className="text-slate-300" />
                <p className="text-sm text-slate-400">No schools found</p>
              </div>
            )}
            {schools.map((school) => (
              <button
                key={school.id}
                onClick={() => handleSelect(school)}
                className="w-full flex items-center gap-3 bg-white rounded-xl px-4 py-3.5 text-left transition-colors hover:bg-slate-50 active:bg-slate-100 shadow-sm border border-slate-100"
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: "#EEF1FB" }}
                >
                  <SchoolIcon size={18} style={{ color: NAVY }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 text-sm truncate">{school.displayName}</p>
                  {(school.region || school.gradeSpan) && (
                    <p className="text-xs text-slate-400 mt-0.5">
                      {[school.region, school.gradeSpan].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
                <ChevronRight size={16} className="text-slate-300 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
