import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

export type UserRole = "COACH" | "SCHOOL_LEADER" | "NETWORK_LEADER" | "NETWORK_ADMIN";

export interface UserRow {
  id:         number;
  email:      string;
  name:       string;
  role:       UserRole;
  schoolId:   number | null;
  schoolName: string | null;
}

interface UserContextValue {
  currentUser: UserRow | null;
  isLoading: boolean;
  refetch: () => Promise<void>;
}

const UserContext = createContext<UserContextValue>({
  currentUser: null,
  isLoading: true,
  refetch: async () => {},
});

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

export function UserProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<UserRow | null>(null);
  const [isLoading, setIsLoading]     = useState(true);

  async function fetchMe() {
    try {
      const res = await fetch(`${BASE}/api/auth/me`, { credentials: "include" });
      if (res.ok) {
        const user = await res.json() as UserRow;
        setCurrentUser(user);
      } else {
        setCurrentUser(null);
      }
    } catch {
      setCurrentUser(null);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { fetchMe(); }, []);

  return (
    <UserContext.Provider value={{ currentUser, isLoading, refetch: fetchMe }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
