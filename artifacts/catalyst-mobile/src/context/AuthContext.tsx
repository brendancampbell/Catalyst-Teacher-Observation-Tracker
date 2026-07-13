import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import { apiFetch, HttpError, User, setUnauthorizedHandler } from "@/lib/api";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
  refetch: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const RETRY_DELAYS_MS = [500, 1000, 2000];

async function fetchMeWithRetry(): Promise<User> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await apiFetch<User>("/api/auth/me");
    } catch (err) {
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
        throw err;
      }
      lastError = err;
      if (attempt < RETRY_DELAYS_MS.length) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      }
    }
  }
  throw lastError;
}

function isAuthError(err: unknown): boolean {
  return err instanceof HttpError && (err.status === 401 || err.status === 403);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  /* Register the centralized 401 handler only while a user is authenticated.
     - Before the initial /me completes (isLoading true): no handler, so the
       expected 401 for unauthenticated visitors is handled by the catch below
       without triggering a redirect loop.
     - After /me: handler registered iff user !== null (has a session).
     - On any mid-session 401: clears user + redirects to login exactly once
       (didRedirect guard prevents duplicate redirects from concurrent calls). */
  useEffect(() => {
    if (isLoading || !user) {
      setUnauthorizedHandler(null);
      return;
    }
    const loginUrl = (import.meta.env.BASE_URL as string).replace(/\/$/, "") + "/";
    let didRedirect = false;
    setUnauthorizedHandler(() => {
      if (didRedirect) return;
      didRedirect = true;
      setUser(null);
      window.location.replace(loginUrl);
    });
    return () => setUnauthorizedHandler(null);
  }, [isLoading, user]);

  const refetch = useCallback(async () => {
    try {
      const u = await fetchMeWithRetry();
      setUser(u);
    } catch (err) {
      if (isAuthError(err)) {
        setUser(null);
      }
    }
  }, []);

  useEffect(() => {
    fetchMeWithRetry()
      .then(setUser)
      .catch((err) => {
        if (isAuthError(err)) {
          setUser(null);
        }
      })
      .finally(() => setIsLoading(false));
  }, []);

  const signOut = useCallback(async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch { /* ignore */ }
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, signOut, refetch }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
