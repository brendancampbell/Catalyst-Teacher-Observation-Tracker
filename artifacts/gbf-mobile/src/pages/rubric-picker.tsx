import React, { useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { useApp } from "@/context/AppContext";
import { AppHeader } from "@/components/AppHeader";
import { apiFetch, RubricSet } from "@/lib/api";
import { ChevronRight, FileText, AlertCircle, Loader2, School, User } from "lucide-react";

const NAVY = "#1034B4";
const YELLOW = "#FFB500";

export default function RubricPickerPage() {
  const { user } = useAuth();
  const { selectedSchool, setSelectedSchool, setSelectedRubric } = useApp();
  const [, navigate] = useLocation();

  const isNetworkAdmin = user?.role === "NETWORK_ADMIN";
  const isNetworkScope = user?.role === "NETWORK_ADMIN" || user?.role === "NETWORK_LEADER";

  useEffect(() => {
    if (!user) {
      navigate("/");
      return;
    }
    if (isNetworkScope && !selectedSchool) {
      navigate("/school-picker");
      return;
    }
    if (!isNetworkScope && !selectedSchool && user.schoolId) {
      setSelectedSchool({ id: user.schoolId, name: user.schoolName ?? "My School" });
    }
  }, [user, selectedSchool, isNetworkScope]);

  const { data: rubricSets, isLoading, isError, refetch } = useQuery<RubricSet[]>({
    queryKey: ["rubricSets"],
    queryFn: async () => {
      const sets = await apiFetch<RubricSet[]>("/api/rubric/sets");
      return sets.filter((r) => !r.isArchived);
    },
    enabled: !!user,
  });

  function handleSelect(rubric: RubricSet) {
    setSelectedRubric(rubric);
    navigate("/observation");
  }

  function handleSwitchSchool() {
    setSelectedSchool(null);
    navigate("/school-picker");
  }

  const schoolName = selectedSchool?.name ?? user?.schoolName ?? undefined;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <AppHeader
        subtitle={schoolName}
        onSwitchSchool={isNetworkAdmin ? handleSwitchSchool : undefined}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pt-5 pb-4">
          <h2 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: NAVY, letterSpacing: "0.04em" }}>
            Select Rubric
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">Choose which rubric to observe against</p>
        </div>

        {isLoading && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 size={28} className="animate-spin" style={{ color: NAVY }} />
            <p className="text-sm text-slate-500">Loading rubrics…</p>
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 px-6 text-center">
            <AlertCircle size={32} className="text-red-400" />
            <p className="text-sm font-semibold text-red-500">Failed to load rubrics</p>
            <button
              onClick={() => refetch()}
              className="px-5 py-2 rounded-lg text-sm font-semibold text-white"
              style={{ backgroundColor: NAVY }}
            >
              Retry
            </button>
          </div>
        )}

        {!isLoading && !isError && rubricSets && (
          <div className="px-4 pb-6 flex flex-col gap-2.5">
            {rubricSets.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
                <FileText size={32} className="text-slate-300" />
                <p className="text-sm text-slate-400">No rubric sets available</p>
              </div>
            )}
            {rubricSets.map((r) => (
              <button
                key={r.id}
                onClick={() => handleSelect(r)}
                className="w-full flex items-center gap-3 bg-white rounded-xl px-4 py-3.5 text-left transition-colors hover:bg-slate-50 active:bg-slate-100 shadow-sm border border-slate-100"
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: NAVY }}
                >
                  {r.target === "SCHOOL"
                    ? <School size={18} color={YELLOW} />
                    : <User size={18} color={YELLOW} />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 text-sm">{r.name}</p>
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
