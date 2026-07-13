import React, { createContext, useContext, useState, ReactNode } from "react";
import { School, RubricSet } from "@/lib/api";

const RUBRIC_LS_KEY  = "catalyst-mobile-selected-rubric";
const SCHOOL_LS_KEY  = "catalyst-mobile-selected-school";

const DRAFT_KEY_PREFIX = "catalyst-mobile-draft-";

function purgeStaleDraftKeys(): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(DRAFT_KEY_PREFIX)) continue;
      const suffix = key.slice(DRAFT_KEY_PREFIX.length);
      const parts = suffix.split("-");
      if (parts.length < 3) {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) {
      localStorage.removeItem(key);
    }
  } catch { /* ignore – storage may be unavailable */ }
}

purgeStaleDraftKeys();

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
