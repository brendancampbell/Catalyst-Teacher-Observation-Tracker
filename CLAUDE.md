# Catalyst

A principal observation tracker for Uncommon Schools. Leaders log classroom
observations for staff at their school, score them against rubric domains, and
assign action steps. Real school data, real staff names — treat it accordingly.

pnpm workspace monorepo. Architecture, stack and page-by-page detail live in
`replit.md` — read it when you need them rather than assuming.

## Commands

Always `pnpm`. A `preinstall` hook rejects npm and yarn.

| Task | Command |
|---|---|
| Typecheck everything | `pnpm run typecheck` |
| Unit tests (no database) | `pnpm run test` |
| Integration tests (builds a throwaway database) | `pnpm run test:clean` |
| Build | `pnpm run build` |
| One package only | `pnpm --filter @workspace/api-server run typecheck` |

`pnpm run test` is the fast tier and needs nothing. `pnpm run test:clean` stands
up a real PostgreSQL, migrates, seeds and starts the API — slower, and the only
way to run the integration tier locally.

CI runs both halves on every push and pull request. A push touching only `.md`
files or `BACKLOG.html` is skipped.

## Rules that bite

These have each caused a real incident. They are not style preferences.

**Never commit staff data.** A roster export carries names, emails and employee
IDs for the whole network. One was committed on 2026-08-18 and had to be removed
by rewriting history. `.gitignore` blocks `*.csv` and `*.xlsx` as a backstop —
the backstop is not the plan.

**Never `git add -A` or `git add .`.** Stage files by name, every time. The
blanket add is what pushed 2,212 staff records. If a commit needs many files,
list them.

**Migration files are immutable once applied.** Files live in
`lib/db/migrations/NNNN_name.sql`. A migration that has run anywhere is history
and never gets edited — a correction is a new numbered migration. Generate with
`pnpm --filter @workspace/db run generate`, never hand-number.

**Know which database answered.** Production is `neondb`; development is
`heliumdb`. The Replit shell's `DATABASE_URL` points at **dev**, and
`PRODUCTION_DATABASE_URL` is unset there. Before reporting what a query
returned, say which database it came from. A surprising result is usually the
wrong database, not a bug.

**Teachers have role `NO_ACCESS`.** The roles are `COACH`, `SCHOOL_LEADER`,
`NETWORK_LEADER`, `NETWORK_ADMIN`, `NO_ACCESS`. `NO_ACCESS` means "cannot sign
in", not "not a person" — it is the default and it is what almost every teacher
is. Filtering it out of a query silently drops every teacher in the network.
Check any people query for this before trusting its count.

**Network Admins are active in every school year and are never rostered.** They
are never counted as a departure and never deactivated for being absent from a
roster file. Everyone else is governed entirely by the roster.

**Authorization is applied by hand, route by route.** The helpers live in
`artifacts/api-server/src/middleware/auth.ts` — `requireRole`,
`enforceSchoolScope`, `canAccessSchoolScopedRecord`, `effectiveSchoolId`.
Nothing applies them for you. Any new route returning people, observations or
action steps must scope to the caller's school itself, or one school sees
another's teacher evaluations. Pair it with a `test-*-cross-school-auth` test in
`artifacts/api-server/src/`; there are several to copy from. Who may do what is
documented in `replit.md` under User Permissions / RBAC — read it there rather
than inferring from a nearby route.

**Don't touch a school-year rollover without reading `ROLLOVER.md` first.**
Activating a year once took the whole app down and needed direct database
surgery. Every guard described in that file exists because of it.

## Working agreements

**Branch, don't commit to `main`.** Replit deploys from `main`, so a
half-finished change on it is live. One branch per change, merge when it works.

**Only one agent works a change at a time.** Replit's own agent commits to this
repository too — commits reading "Published your App" are its, not the user's.
Two editing at once produces conflicts and lost edits.

**Refer to backlog items by their permanent ID**, never by position in the list.
Positions shift; `#44` does not. The backlog is `BACKLOG.html`.

**Say what changed, up front.** If a change touches anything user-facing, or
anything that wasn't asked for, name it in the first line of the reply. Don't
leave it to be discovered in a summary at the bottom.

## Walking the user through a change

The user is non-technical and will not remember the git steps. Drive them, and
narrate each one as it happens rather than doing it silently.

**Before anything else, get current.** Every piece of work starts with
`git checkout main` then `git pull`. Replit commits to this repository on its
own, so the `main` on this machine is routinely behind the real one. A branch
cut from a stale `main` builds on yesterday's truth and conflicts on the way
back in. Say this step out loud each time — the user has asked to be reminded
of it, not to have it done silently.

**Starting work.** If a change touches code, the database, or anything a user
sees, it goes on a branch. Say so, propose a branch name, then create it from
the freshly pulled `main`. Changes to only `*.md`, `BACKLOG.html`, `LICENSE` or
`.gitignore` can go straight to `main` — that is the same line CI already draws
in `paths-ignore`.

**Offering a preview.** The user cannot run this app on their Mac — no local
PostgreSQL, no `.env`. To see a branch they switch the Replit workspace to it
via the Git pane (Tools → + → Git). Remind them that this swaps the workspace
over rather than showing both, and that a branch carrying a new migration
applies it to the dev database on switch, which does not undo on switching
back.

**Finishing.** Push the branch, open a pull request, and give the user the
link. Say what CI is checking and wait for it. **Never merge without being
asked** — the merge is the user's decision, and reviewing the PR is where they
exercise it. After a merge, remind them Replit pulls `main` and runs
`scripts/post-merge.sh`, which applies migrations.

**A branch copies code, not data.** One database sits behind whichever branch
runs. Records created while testing are real, and migrations are one-way. Say
this out loud before any change that writes to the database.

## Communication

The user is non-technical. Short, plain sentences. Skip the implementation tour
unless asked — lead with what changed and what it means for the app. Jargon only
where there is no plain equivalent.

## Where things are written down

Pointers, not imports — read these when the task calls for them.

- `replit.md` — stack, structure, pages, feature list
- `ROLLOVER.md` — school-year rollover procedure and its guards
- `.agents/memory/MEMORY.md` — index of past decisions and the reasoning
  behind them; one file per topic in the same folder
- `BACKLOG.html` — what's next, by ID
- `threat_model.md` — security posture
- `schema.sql` — current database schema

When you learn something non-obvious that a future session would need — why a
constraint exists, why an approach failed — add it to `.agents/memory/` and put
a one-line pointer in that folder's `MEMORY.md`.
