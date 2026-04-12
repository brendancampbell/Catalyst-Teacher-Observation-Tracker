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

interface RealUser {
  id:   number;
  name: string;
}

interface UserContextValue {
  currentUser:      UserRow | null;
  isLoading:        boolean;
  refetch:          () => Promise<void>;
  isImpersonating:  boolean;
  realUser:         RealUser | null;
}

const UserContext = createContext<UserContextValue>({
  currentUser:     null,
  isLoading:       true,
  refetch:         async () => {},
  isImpersonating: false,
  realUser:        null,
});

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

export function UserProvider({ children }: { children: ReactNode }) {
  const [currentUser,     setCurrentUser]     = useState<UserRow | null>(null);
  const [isLoading,       setIsLoading]       = useState(true);
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [realUser,        setRealUser]        = useState<RealUser | null>(null);

  async function fetchMe() {
    try {
      const res = await fetch(`${BASE}/api/auth/me`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json() as UserRow & { _isImpersonating?: boolean; _realUser?: RealUser | null };
        const { _isImpersonating, _realUser, ...user } = data;
        setCurrentUser(user);
        setIsImpersonating(!!_isImpersonating);
        setRealUser(_realUser ?? null);
      } else {
        setCurrentUser(null);
        setIsImpersonating(false);
        setRealUser(null);
      }
    } catch {
      setCurrentUser(null);
      setIsImpersonating(false);
      setRealUser(null);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { fetchMe(); }, []);

  return (
    <UserContext.Provider value={{ currentUser, isLoading, refetch: fetchMe, isImpersonating, realUser }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
