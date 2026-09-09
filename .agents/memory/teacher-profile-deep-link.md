# Deep-linking to a teacher's profile

The profile is **not a route**. It is `TeacherScoreOverlay`, rendered over the
dashboard by `components/Dashboard.tsx` when `profileTeacher` resolves. The only
deep link into it is `/?teacher=<id>`, and every teacher link in the Action
Center is one.

`<id>` is the employee id. The dashboard route maps `id: p.employeeId`, so
`Teacher.id` and `Teacher.employeeId` carry the **same value** — a lookup on
either works. Do not "fix" a profile-not-opening bug by matching both fields;
that changes nothing. This was tried on 31 Aug 2026 and was a no-op.

## Two effects race, and the URL loses — resolved 8 Sep 2026 by #61

**This race no longer exists.** `#61` removed the mirror that caused it: the
address is now the single source of truth, `teacherProfileId` **is**
`?teacher=`, and there is no state to race with the URL. The auto-open effect
and the `urlTeacherId` capture below are gone. The history that follows is kept
because the shape of the bug recurs, not because the code still looks like this.

The closing warning has changed accordingly: reading a URL parameter into a
`useState` is the mistake now. Do not — read it from `lib/urlState.ts` and write
it back through `setParams`. See `url-is-the-view-state.md`.

---

`Dashboard.tsx` had a "sync view state → URL" effect that rebuilt the whole
query string from component state and called `replaceState`. It ran on mount,
**before** the dashboard query resolved, when `teacherProfileId` was still null —
so it wrote a URL with no `teacher` parameter and the id was gone.

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

**Anything that reads a URL parameter into state has this same race** wherever
a sync effect rebuilds the query string. Both are gone from this app; the rule
now is simply that state which belongs in the address should not also live in a
`useState`.

## The school has to travel with the link

There were **two** failures behind "clicking a teacher goes to the dashboard",
and fixing the race above only fixed it for school leaders.

`Dashboard.tsx` computes `isDistrictHome = isNetworkRole && schoolId == null`
and returns `<DistrictDashboard>` at that point — **before** `profileTeacher` is
ever looked at, and with the dashboard query disabled (`enabled: !isDistrictHome`)
so no teacher ever loads. For a NETWORK_ADMIN or NETWORK_LEADER, a bare
`/?teacher=<id>` is therefore the district view and the teacher parameter is not
so much ignored as never reached.

School leaders never saw this half: their own `schoolId` fills in as a fallback.
Any test signed in as a school leader is blind to it, which is exactly how the
first fix shipped looking correct.

Links into the dashboard must be built with `teacherProfileHref` (in
`lib/school-context.ts`), which carries the school the current page was opened
with. The module docstring there already described this class of bug for the
Action Center; the teacher links simply were not using it.

## The page that used to exist

`pages/TeacherProfile.tsx` at `/teacher/:employeeId` was a second, thinner
teacher page — action steps only, no observation history — added 13 Jul 2026
(`117b685`). Backlog #40 was opened because landing on it looked like the app had
lost features. Retired 31 Aug 2026 once the profile overlay covered action steps
(`ActionStepsCard`, `ActionStepsDrawer`) and nothing linked to it. Do not
reintroduce a separate teacher route; extend the overlay.
