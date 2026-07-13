import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { setUnauthorizedHandler } from "@/lib/api";

export type UserRole = "COACH" | "SCHOOL_LEADER" | "NETWORK_LEADER" | "NETWORK_ADMIN";

export interface UserRow {
  id:                 number;
  email:              string;
  name:               string;
  role:               UserRole;
  schoolId:           number | null;
  schoolName:         string | null;
  schoolAbbreviation: string | null;
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

  /* Register the centralized 401 handler only while a user is authenticated.
     - fetchMe calls fetch() directly, so the initial /me 401 (unauthenticated
       visitor) is handled by fetchMe's own else-branch — no redirect loop.
     - Once logged in, any apiFetch 401 (session expiry mid-use) fires this:
       clears state and hard-navigates to the login page exactly once.
     - didRedirect guard prevents concurrent 401s from stacking redirects.   */
  useEffect(() => {
    if (isLoading || !currentUser) {
      setUnauthorizedHandler(null);
      return;
    }
    const loginUrl = `${BASE}/login`;
    let didRedirect = false;
    setUnauthorizedHandler(() => {
      if (didRedirect) return;
      didRedirect = true;
      setCurrentUser(null);
      setIsImpersonating(false);
      setRealUser(null);
      window.location.replace(loginUrl);
    });
    return () => setUnauthorizedHandler(null);
  }, [isLoading, currentUser]);

  return (
    <UserContext.Provider value={{ currentUser, isLoading, refetch: fetchMe, isImpersonating, realUser }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
