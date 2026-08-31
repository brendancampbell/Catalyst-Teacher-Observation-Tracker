# Deep-linking to a teacher's profile

The profile is **not a route**. It is `TeacherScoreOverlay`, rendered over the
dashboard by `components/Dashboard.tsx` when `profileTeacher` resolves. The only
deep link into it is `/?teacher=<id>`, and every teacher link in the Action
Center is one.

`<id>` is the employee id. The dashboard route maps `id: p.employeeId`, so
`Teacher.id` and `Teacher.employeeId` carry the **same value** — a lookup on
either works. Do not "fix" a profile-not-opening bug by matching both fields;
that changes nothing. This was tried on 31 Aug 2026 and was a no-op.

## Two effects race, and the URL loses

`Dashboard.tsx` has a "sync view state → URL" effect that rebuilds the whole
query string from component state and calls `replaceState`. It runs on mount,
**before** the dashboard query resolves, when `teacherProfileId` is still null —
so it writes a URL with no `teacher` parameter and the id is gone.

The auto-open effect used to wait for `teachers.length > 0`. On a cold load the
teacher list arrives after the URL has already been rewritten, so it never saw
both conditions true and the profile silently never opened. You landed on a
working-looking dashboard with nothing to say anything had failed.

A warm react-query cache hid it completely: with teachers already present both
effects run in the same commit and the auto-open one is declared first. So it
worked when clicking around inside the app and failed from the Action Center,
which is a full page load.

The fix is to capture `urlTeacherId` on mount without waiting for data.
`profileTeacher` stays null until the list resolves, so holding the id early
renders nothing. Guarded by `Dashboard.teacherDeepLink.test.tsx`, which mocks
`useSearch` against the live URL — a static-string mock cannot see this bug,
because the component under test is the one rewriting the URL.

**Anything new that reads a URL parameter into state has this same race.** The
URL-sync effect will delete a parameter it does not know about.

## The page that used to exist

`pages/TeacherProfile.tsx` at `/teacher/:employeeId` was a second, thinner
teacher page — action steps only, no observation history — added 13 Jul 2026
(`117b685`). Backlog #40 was opened because landing on it looked like the app had
lost features. Retired 31 Aug 2026 once the profile overlay covered action steps
(`ActionStepsCard`, `ActionStepsDrawer`) and nothing linked to it. Do not
reintroduce a separate teacher route; extend the overlay.
