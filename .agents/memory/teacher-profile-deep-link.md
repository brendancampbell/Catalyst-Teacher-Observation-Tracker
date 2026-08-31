# Deep-linking to a teacher's profile

The profile is **not a route**. It is `TeacherScoreOverlay`, rendered over the
dashboard by `components/Dashboard.tsx` when `profileTeacher` resolves. The
only deep link into it is `/?teacher=<id>`.

## Two different ids arrive in that one parameter

`Teacher` carries both `id` (internal) and `employeeId` — they are different
values.

- The dashboard's own links pass `t.id`; `Dashboard.tsx` also writes
  `?teacher=<teacherProfileId>` back into the URL from that same field.
- **The Action Center rows only carry `employeeId`.** The rescore queue and the
  Latest Action Step tab both link with it.

`profileTeacher` originally matched on `t.id` alone, so every Action Center
teacher link found nothing and fell through to the plain dashboard — a silent
failure, since a dashboard is a plausible-looking page to land on. It now tries
`id` first, then `employeeId`. Keep that order: `id` is what the app writes, and
matching `employeeId` first would let a collision win.

If a new caller has neither id to hand, add the id to its payload rather than
introducing a third thing this parameter accepts.

## The page that used to exist

`pages/TeacherProfile.tsx` at `/teacher/:employeeId` was a second, thinner
teacher page — action steps only, no observation history — added 13 Jul 2026
(`117b685`). Backlog #40 was opened because landing on it looked like the app
had lost features. It was retired on 31 Aug 2026 once the profile overlay
covered action steps (`ActionStepsCard` + `ActionStepsDrawer`) and nothing
linked to it any more. Do not reintroduce a separate teacher route; extend the
overlay.
