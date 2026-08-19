# School-year rollover

How to move Catalyst from one school year to the next, and how to rehearse it
first on a throwaway year.

Read this before touching a real rollover. The 2026-08-18 incident — activating
a year took the whole app down and needed direct database surgery to recover —
is the reason every guard described here exists.

## What a rollover actually is

Two things have to be true of the new year before it can go live:

| Precondition | Why it exists |
|---|---|
| The year has a **roster** — at least one open assignment | An empty year makes `checkActiveThisYear()` false for every user at once, and every route 403s |
| The year has an **active rubric set** | Without one, people can sign in but nothing can be scored |

`GET /api/admin/school-years/:id/readiness` reports both. Activation returns
`409 NOT_READY_TO_ACTIVATE` with a `blockers` array naming whichever is missing.

**Network Admins are active in every school year and are never rostered.**
They administer the years, so requiring them on each year's roster inverted the
dependency — the person who loads the roster had to already be on it. It
follows that an admin is never counted as a departure and never deactivated for
being absent from a file, and that there is no self-lockout left to guard
against. Everyone else is governed entirely by the roster.

## The roster is the source of truth

One network-wide file listing every staff member and the school they will be at.

- Present, different school → **moved**, reassigned.
- Present, same school → unchanged.
- Not in `people` at all → **new hire**, created.
- **Absent entirely** → left, deactivated when the year flips.
- A Network Admin → not rostered at all; leave them out of the file.

That last rule is why the file must be complete. A truncated file is
indistinguishable from a mass resignation, which is what the dry run is for.

An **absent file** is different from a truncated one, though, and the code
treats it differently: when the incoming year has no roster at all and no
upload is pending, nobody is counted as departing. "The year is empty" is not a
claim that everyone resigned. A first roster into an empty year still identifies
departures normally — the distinction is between *no roster* and *a roster that
omits you*, not between empty and non-empty.

Identity is `employeeId`. A row whose `employeeId` already belongs to a
different email is rejected rather than merged — a mistyped ID and a genuine
email change need opposite fixes, and guessing rewrites the wrong person.

## Staging is inert

Uploading a roster for a year that is not active writes **assignment rows and
nothing else**. No person is deactivated, nobody's school changes, and new
hires are created with `isActive: false` so they cannot sign in yet. The
running year is completely undisturbed, and staged rows are invisible because
every read route filters on the active year.

Everything deferred lands atomically at the flip.

> New hires are the one place staging touches `people`. The row must exist
> because `assignments.user_id` is a foreign key; `isActive: false` is what
> keeps it inert.

## Rehearsal

Do this on a scratch year before the real thing. It exercises every path
including rollback, and touches only rows you created.

1. **Create a scratch year.** Admin → School Years → new year, leave it
   inactive. Give it a `displayOrder` above the real years so it sorts last.

2. **Copy a rubric set forward** into it from the active year.

3. **Check readiness** — it should refuse, naming the missing roster:

   ```bash
   curl -s -b cookies.txt localhost:8080/api/admin/school-years/$SCRATCH/readiness
   ```

4. **Stage a roster, dry run first.** You do not need to be in it — admins are
   active in every year:

   ```bash
   curl -s -b cookies.txt -X POST localhost:8080/api/people/bulk \
     -H 'Content-Type: application/json' \
     -d '{"schoolYearId":'"$SCRATCH"',"dryRun":true,"rows":[...]}'
   ```

   Read `counts` and `bySchool` carefully. **`remaining` per school is the
   check that matters** — a school showing zero remaining almost always means
   that school is missing from the file, not that everyone there resigned.

5. **Re-run without `dryRun`.** Then confirm nothing moved yet: pick someone
   changing schools and verify their `people.school_id` is still the old one.

6. **Activate.** Confirm afterwards that staying staff keep access, moved staff
   see their new school, the new hire can now sign in, and departed staff are
   deactivated.

7. **Roll back** — activate the previous year again. Departed staff come back,
   school moves are undone.

8. **Clean up** the scratch year's assignments, rubric set, and the year row.

The same ground is covered automatically:

```bash
pnpm --filter @workspace/api-server run test:school-year-rollover
```

## The real rollover

Same sequence, minus the scratch year, plus one habit: **run the dry run more
than once**, and only stop when the departure list is a list of names you
recognise as actually having left. That list is the entire safety mechanism.

## Rolling back

Activating the previous year is a supported action, not an emergency hack. It
works because activating a year restores the roster *of* that year: a
departure's assignment row is reopened, and reopening it reactivates them.

Two things it does **not** undo:

- Observations or action steps created while the new year was active. They stay
  in that year; nothing is deleted.
- People deactivated by hand through the Users tab. Only departures created by
  a flip are reversed — `toggle-active` never end-dates an assignment, which is
  precisely how the two are told apart.

## What does not carry forward

Open drafts, unresolved action steps, and the rescore queue all stay in the old
year, by design. `GET /:id/activation-preview` counts them before you flip so
the loss is explicit rather than discovered later.

Rubric sets do not copy themselves either — that is the separate
`POST /api/rubric/sets/:id/copy-forward` step, and the activation gate checks
you remembered to run it.

## If you are locked out anyway

`NETWORK_ADMIN` is active in every school year (`checkActiveThisYear()` in
`lib/passport.ts`, with a second guard in `schoolYearBlocked()`), so an admin
can always reach the admin UI regardless of roster state. If even that fails,
the recovery is still a one-row update:

```sql
UPDATE school_years SET status = 'inactive';
UPDATE school_years SET status = 'active' WHERE id = <the year that worked>;
```

Then restart the API so `getActiveSchoolYearId()`'s cache clears.
