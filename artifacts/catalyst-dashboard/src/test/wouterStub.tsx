import React from "react";

/**
 * A wouter double that actually navigates.
 *
 * These pages read their view state out of the address and write it back
 * (#61), so a stub whose navigate is a no-op makes a test pass or fail for
 * reasons that have nothing to do with the code under test: clicking a tab
 * updates nothing, and Back has nothing to restore. Nine test files had
 * hand-rolled a version of this; only one of them was reactive.
 *
 * Behaves like the real thing in the ways these tests depend on:
 *   - navigate writes real history, honouring { replace }
 *   - useSearch re-renders on any history change, including popstate
 *
 * Use instead of a bare object literal:
 *   vi.mock("wouter", () => makeWouterStub());
 */
export function makeWouterStub() {
  const EVENT = "catalyst:test-navigate";

  const emit = () => window.dispatchEvent(new Event(EVENT));

  const subscribe = (cb: () => void) => {
    window.addEventListener(EVENT, cb);
    window.addEventListener("popstate", cb);
    return () => {
      window.removeEventListener(EVENT, cb);
      window.removeEventListener("popstate", cb);
    };
  };

  const useLive = () => {
    const [, force] = React.useReducer((n: number) => n + 1, 0);
    React.useEffect(() => subscribe(force), []);
  };

  const useSearch = () => {
    useLive();
    return window.location.search.replace(/^\?/, "");
  };

  const navigate = (
    to: string,
    opts?: { replace?: boolean; state?: unknown },
  ) => {
    window.history[opts?.replace ? "replaceState" : "pushState"](
      opts?.state ?? null,
      "",
      to,
    );
    emit();
  };

  const useLocation = () => {
    useLive();
    return [window.location.pathname, navigate] as const;
  };

  return {
    useSearch,
    useLocation,
    navigate,
    Link: ({ children }: { children: React.ReactNode }) => children,
  };
}
