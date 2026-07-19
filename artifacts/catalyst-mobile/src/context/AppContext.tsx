import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, School, RubricSet } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { isNetworkScope } from "@/lib/roles";

const RUBRIC_LS_KEY  = "catalyst-mobile-selected-rubric";
const SCHOOL_LS_KEY  = "catalyst-mobile-selected-school";

function loadStoredRubric(): RubricSet | null {
  try {
    const raw = localStorage.getItem(RUBRIC_LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as RubricSet;
  } catch {
    return null;
  }
}

function loadStoredSchool(): School | null {
  try {
    const raw = localStorage.getItem(SCHOOL_LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as School;
  } catch {
    return null;
  }
}

interface AppContextType {
  selectedSchool: School | null;
  setSelectedSchool: (s: School | null) => void;
  selectedRubric: RubricSet | null;
  setSelectedRubric: (r: RubricSet | null) => void;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [selectedSchool, setSelectedSchool] = useState<School | null>(loadStoredSchool);
  const [selectedRubric, setSelectedRubric] = useState<RubricSet | null>(loadStoredRubric);

  const { user } = useAuth();
  const networkScope = isNetworkScope(user);

  const { data: schools } = useQuery<School[]>({
    queryKey: ["schools"],
    queryFn: () => apiFetch<School[]>("/api/admin/schools"),
    enabled: networkScope && selectedSchool !== null,
  });

  const { data: rubricSets } = useQuery<RubricSet[]>({
    queryKey: ["rubricSets"],
    queryFn: () => apiFetch<RubricSet[]>("/api/rubric/sets"),
    enabled: selectedRubric !== null,
  });

  useEffect(() => {
    if (!schools || !selectedSchool) return;
    const valid = schools.some((s) => s.id === selectedSchool.id);
    if (!valid) {
      setSelectedSchool(null);
      try {
        localStorage.removeItem(SCHOOL_LS_KEY);
      } catch { /* ignore */ }
    }
  }, [schools, selectedSchool]);

  useEffect(() => {
    if (!rubricSets || !selectedRubric) return;
    const valid = rubricSets.some((r) => r.id === selectedRubric.id);
    if (!valid) {
      setSelectedRubric(null);
      try {
        localStorage.removeItem(RUBRIC_LS_KEY);
      } catch { /* ignore */ }
    }
  }, [rubricSets, selectedRubric]);

  function handleSetSelectedSchool(s: School | null) {
    setSelectedSchool(s);
    try {
      if (s) {
        localStorage.setItem(SCHOOL_LS_KEY, JSON.stringify(s));
      } else {
        localStorage.removeItem(SCHOOL_LS_KEY);
      }
    } catch { /* ignore */ }
  }

  function handleSetSelectedRubric(r: RubricSet | null) {
    setSelectedRubric(r);
    try {
      if (r) {
        localStorage.setItem(RUBRIC_LS_KEY, JSON.stringify(r));
      } else {
        localStorage.removeItem(RUBRIC_LS_KEY);
      }
    } catch { /* ignore */ }
  }

  return (
    <AppContext.Provider value={{ selectedSchool, setSelectedSchool: handleSetSelectedSchool, selectedRubric, setSelectedRubric: handleSetSelectedRubric }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
