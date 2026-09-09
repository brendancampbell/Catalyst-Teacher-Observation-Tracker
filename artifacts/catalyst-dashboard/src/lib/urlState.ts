import { useCallback, useMemo } from "react";
import { useLocation, useSearch } from "wouter";

/* ══ View state in the address bar (#61) ═══════════════════════════════
   Back should step out of a school or a teacher, and never unwind a
   filter one value at a time.  That line is drawn here, once, so every
   screen draws it the same way:

     "push"     a new history entry — drilling in.  Opening a school,
                opening a teacher, opening a panel.  Back closes it.
     "replace"  the current entry — everything else.  Tabs and filters
                still land in the address (so the link you can paste
                matches the screen you are on) but cost no Back press.

   Reading goes through wouter's useSearch, which re-renders on popstate,
   so the address is the single source of truth: pressing Back rewrites
   the query string and the view follows it.  State mirrored into a
   useState alongside will NOT follow Back — that is the bug this
   replaces.                                                            */

export type UrlChanges = Record<string, string | null | undefined>;

/* Marks a history entry this app pushed to open something. Lets a close
   button unwind that entry instead of stacking another one on top — without
   the marker, closing would leave [list, list] behind and the next Back
   press would look like it did nothing. Absent when the view was reached by
   a pasted link, where there is nothing of ours to go back to. */
const PUSHED = "catalystPushed";

export function useUrlState() {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);

  const setParams = useCallback(
    (changes: UrlChanges, mode: "push" | "replace") => {
      /* Built from the live address rather than the render's copy, so two
         updates in one tick don't clobber each other. */
      const next = new URLSearchParams(window.location.search);
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === undefined || value === "") next.delete(key);
        else next.set(key, value);
      }
      const qs = next.toString();
      navigate(location + (qs ? "?" + qs : ""), {
        replace: mode === "replace",
        state:   mode === "push" ? { [PUSHED]: true } : window.history.state,
      });
    },
    [location, navigate],
  );

  /* Closing something that was opened with "push". Steps back through the
     entry we added, so Back and the close button agree. Falls back to
     clearing the params in place when we did not push the current entry —
     someone arriving on ?teacher=… from a link has nothing behind them, and
     history.back() there would walk them out of the app. */
  const closeParams = useCallback(
    (changes: UrlChanges) => {
      const pushedByUs =
        typeof window !== "undefined" &&
        !!(window.history.state as Record<string, unknown> | null)?.[PUSHED];
      if (pushedByUs) {
        window.history.back();
        return;
      }
      setParams(changes, "replace");
    },
    [setParams],
  );

  return { params, setParams, closeParams };
}

/* ── Readers ────────────────────────────────────────────────────────── */

/** A comma-joined list param (subjects, grades, prof). */
export function readList(params: URLSearchParams, key: string): string[] {
  const raw = params.get(key);
  return raw ? raw.split(",").filter(Boolean) : [];
}

/** Writes a list back, dropping the key entirely when empty so cleared
    filters leave no trace in a link someone is about to paste. */
export function writeList(values: string[]): string | null {
  return values.length ? values.join(",") : null;
}

/** A param constrained to a known set, falling back when absent or stale
    (a hand-edited or out-of-date link must not render a broken view). */
export function readEnum<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = params.get(key);
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}
