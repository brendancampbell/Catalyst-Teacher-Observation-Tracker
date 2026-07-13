import React, { createContext, useContext, useState, ReactNode } from "react";
import { School, RubricSet } from "@/lib/api";

const RUBRIC_LS_KEY = "catalyst-mobile-selected-rubric";

function loadStoredRubric(): RubricSet | null {
  try {
    const raw = localStorage.getItem(RUBRIC_LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as RubricSet;
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
  const [selectedSchool, setSelectedSchool] = useState<School | null>(null);
  const [selectedRubric, setSelectedRubric] = useState<RubricSet | null>(loadStoredRubric);

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
    <AppContext.Provider value={{ selectedSchool, setSelectedSchool, selectedRubric, setSelectedRubric: handleSetSelectedRubric }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
