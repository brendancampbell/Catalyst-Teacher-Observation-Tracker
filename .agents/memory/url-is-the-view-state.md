# The address is the view state (#61, 8 Sep 2026)

Everything about what you are looking at lives in the query string, read and
written through `artifacts/catalyst-dashboard/src/lib/urlState.ts`. There is no
second copy in a `useState`. That is the whole design, and the bug it replaced
is what happens when there are two copies.

## Why a mirror cannot work

The dashboard used to hold view state in `useState` and rebuild the query string
from it in one big effect. The data flowed one way only. Pressing Back rewrote
the address, the effect fired, and it immediately overwrote Back's work from
state that had not changed — so Back moved the address and nothing on screen
moved. It also raced on cold load, stripping `?teacher=` before the roster
arrived (see `teacher-profile-deep-link.md`).

Reading with `useSearch` makes the component re-render on `popstate`, so Back
restores the view for free. **Do not read a parameter into a `useState`.** The
moment there are two copies, one of them is wrong after a Back press.

## push vs replace — the line, and why it is drawn there

- **push** — drilling in. Opening a school, a teacher, or a panel. Back closes it.
- **replace** — everything else. Tabs, filters, view toggles, rubric choice.

Both end up in the link, so a pasted link matches the screen. Only the first
costs a Back press. "Everything pushes" was considered and rejected: setting
three filters would take three Back presses to leave a page.

Decided with the user on 8 Sep 2026. Filters were nearly moved out of the link
into browser storage — that was reversed, because a link that silently drops
your filters shows a colleague different numbers than you were looking at.

## Closing a panel must unwind, not stack

`closeParams` checks for a `catalystPushed` marker on the current history entry.
If we pushed it, it calls `history.back()`. Otherwise it clears the parameter in
place.

Both halves matter. Clearing in place after a push leaves `[list, list]` behind,
and the next Back press looks broken. Calling `back()` on an entry we did not
push walks the reader out of the app — which is what a pasted `?teacher=` link
is, since there is nothing of ours behind it.

## Batch a multi-key change into one call

`setParams` rebuilds from the **live** address, so two calls in one tick each
start from the same place and only the last survives. Clearing three filters, or
swapping a drill-down for a profile, is one call with several keys.

## Fall back on unknown values, never render them

`readEnum` returns the fallback for a parameter it does not recognise. This
covers a link shared before a tab was renamed, and a hand-edited one. It is also
where role gating lands: the Action Center builds its allowed tab set from the
same `NETWORK_ADMIN` condition its tab bar uses, so a coach opening an admin's
`?tab=analysis` link gets Summary rather than an empty panel. Settings needs no
such check — `visibleTab` already falls back to that person's leftmost tab.

## What deliberately stays a full page reload

Starting and stopping impersonation, in `ImpersonationBanner.tsx` and
`admin.tsx`. The reload is what drops the previous identity's cached teacher and
observation data from react-query. Routing there client-side would carry one
person's cache into another's session, and Back must never return you into an
impersonation session. Leave them.

## Editing modals are not panels

Back closes something you are reading. It must never discard a half-written
observation, so `NewObservationModal` and the edit flows stay in component state.

## Test doubles must actually navigate

Nine test files stubbed wouter with `useLocation: () => ["/", vi.fn()]`. That
navigate does nothing, so clicking a tab changed no address and a test could pass
for entirely the wrong reason. They now share `src/test/wouterStub.tsx`, which
writes real history and re-renders on change. Switching to it fixed six failures
in files the change had not otherwise touched. Use it; do not hand-roll another.

jsdom queues history traversal — `history.back()` needs the `popstate` event
awaited, not a `setTimeout(0)`.
