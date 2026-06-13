import React, { createContext, useContext, useState, ReactNode } from "react";
import { School, RubricSet } from "@/lib/api";

interface AppContextType {
  selectedSchool: School | null;
  setSelectedSchool: (s: School | null) => void;
  selectedRubric: RubricSet | null;
  setSelectedRubric: (r: RubricSet | null) => void;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [selectedSchool, setSelectedSchool] = useState<School | null>(null);
  const [selectedRubric, setSelectedRubric] = useState<RubricSet | null>(null);

  return (
    <AppContext.Provider value={{ selectedSchool, setSelectedSchool, selectedRubric, setSelectedRubric }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
