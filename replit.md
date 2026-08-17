# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Contains the **Catalyst Principal Dashboard** for Uncommon Schools — a full-stack principal observation tracker.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **Frontend**: React + Vite + TailwindCSS + TanStack React Query + Wouter
- **Build**: esbuild (API), Vite (frontend)

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/          # Express API server (port 8080)
│   └── catalyst-dashboard/  # React + Vite frontend
├── lib/
│   ├── db/                  # Drizzle ORM schema + DB connection
│   ├── api-spec/            # OpenAPI spec + Orval codegen config
│   ├── api-client-react/    # Generated React Query hooks
│   └── api-zod/             # Generated Zod schemas from OpenAPI
├── scripts/                 # Utility scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Catalyst Principal Dashboard

### Application Overview

A principal observation tracker for Uncommon Schools. Leaders log classroom observations for the staff at their school, scoring them on rubric domains grouped into categories. The dashboard shows most-recent or period-average scores for all teachers in a color-coded grid with category sub-averages and a Proficient column.

### Key Pages

- `/` — Main dashboard grid (observation tracker)
- `/admin` — Admin settings (tabs are role-gated; COACH is blocked entirely)
- `/action-center` — Rescore queue, overdue observations, overdue action steps
- `/drafts` — The current user's unpublished observation drafts
- `/teacher/:employeeId` — Individual profile with score history

### Features

- Real-time data from PostgreSQL via Express API
- Filter by subject, grade level; view by teacher, subject, or grade
- "Most Recent" vs "Quarter Average" toggle
- Click any teacher name → full profile view
- Click any score cell → drill-down with trend chart
- "Add Observation" modal with all domains scored 0 / 0.5 / 1.0
- Category sub-average columns for each rubric category
- Overall AVG = average of category sub-averages
- Proficient column (≥0.7 = Proficient, <0.7 = Not Yet)
- Admin rubric manager for managing categories and domains
- **User Permissions / RBAC**: Roles: COACH, SCHOOL_LEADER, NETWORK_LEADER, NETWORK_ADMIN
  - COACH: school-based, can view school data + create observations; no admin access
  - SCHOOL_LEADER: school-based, can view school data + create observations + edit school settings (roster)
  - NETWORK_LEADER: assigned to the Home Office school, sees the district view and every school's data, can create observations and manage people network-wide; NO network settings (rubric / schools / school years)
  - NETWORK_ADMIN (Super Admin): assigned to the Home Office school, full access to all views and all settings, and the only role that can impersonate
  - NO_ACCESS: provisioned but blocked at login; sessions are invalidated immediately on downgrade
  - Authentication: Google OAuth 2.0 (passport.js) — only pre-provisioned emails can sign in
  - Admin button hidden from COACH role
  - Admin page blocked for COACH (shows Access Restricted screen)
  - Walkthrough toggle shown to SCHOOL_LEADER | NETWORK_LEADER | NETWORK_ADMIN
- **User Management** (Admin > Users tab): Add, Edit, Deactivate people (soft-delete via `people.isActive`). Covers both staff and observable teachers — they are the same table. Deactivated users cannot log in (blocked at OAuth callback) and cannot be impersonated; existing impersonation sessions auto-terminate. NETWORK_ADMIN scope is global; SCHOOL_LEADER scope is own school + only COACH/SCHOOL_LEADER targets. Self-deactivation blocked.

### Design

- **Brand colors**: Navy `#1034B4`, Yellow `#FFB500`
- **Fonts**: Bebas Neue (headlines, stats, buttons), Libre Franklin (body)
- Score colors: Green (≥0.7 = Proficient), Yellow (≥0.5 = Developing), Red (<0.5 = Not Yet)
- Scoring scale: 0 (Not Yet) / 0.5 (Developing) / 1.0 (Proficient)

### Database Schema (lib/db/src/schema/)

There is **no `users` table and no `teachers` table** — both were consolidated
into a single `people` table keyed by `employeeId`. Staff and observed teachers
are the same records, distinguished by `role` and `includeInFeedbackTracker`.

- `people` — employeeId (PK, text), firstName, lastName, email (NOT NULL, unique), googleId (unique, set on first Google login), role (COACH | SCHOOL_LEADER | NETWORK_LEADER | NETWORK_ADMIN | NO_ACCESS), isActive, includeInFeedbackTracker (marks someone as observable), schoolId (FK), department (enum), gradeLevel (text[]), needsRescore, rescoreDueDate, rescoreSchoolYearId
- `schools` — id, displayName, fullName, abbreviation (unique), region, gradeSpan, isActive, isArchived, isHomeOffice, schoolNumber
- `school_years` — id, name, status (active | inactive), displayOrder, startDate, endDate
- `assignments` — userId (→people), role, schoolId, schoolYearId, startDate, endDate (NULL = current). Drives "is this person active this school year?"
- `rubric_sets` — id, slug, name, schoolYearId, isActive, isArchived, gradeSpan, description, displayOrder, target (TEACHER | SCHOOL), subjectAudience (STEM | HUMANITIES | ALL). Unique on (schoolYearId, slug)
- `rubric_categories` — id, rubricSetId, name, displayOrder
- `rubric_domains` — id, categoryId, rubricSetId, schoolYearId, name, slug, displayOrder, description. Unique on (schoolYearId, rubricSetId, slug)
- `observations` — id, observedEmployeeId, schoolId (frozen at creation — authorization uses this, not the teacher's current school), schoolYearId, rubricSetId, observerEmployeeId, date, time, course, strengths, growthAreas, isWalkthrough, status (draft | published), target (TEACHER | SCHOOL), snapshotGradeSpan, editedByEmployeeId, updatedAt
- `observation_scores` — id, observationId, domainSlug, score (real: 0 / 0.5 / 1.0). Unique on (observationId, domainSlug)
- `action_steps` — id, teacherEmployeeId, assignedByEmployeeId, assignedDuringObservationId, text, dueDate, status (open | mastered), masteredAt / masteredByEmployeeId / masteredDuringObservationId, schoolYearId, snapshotSchoolId, snapshotGradeSpan, snapshotRole
- `chat_sessions` / `chat_messages` — AI assistant history, scoped per employeeId
- `ai_quota_grants` — per-person extra AI request allowances that bypass rate limits
- `platform_notifications` / `notification_dismissals` — admin-authored in-app announcements
- `qualitative_themes_cache` — cached AI theme summaries, keyed (schoolId, rubricSlug)
- `rate_limit_store` — persistent rate-limit counters (survives restarts)

### API Endpoints (artifacts/api-server/)

All routes mounted at `/api`:

- `GET /api/dashboard?rubricSet=Q1` — Full dashboard data (active teachers only + observations)
- `GET /api/teachers/:id?rubricSet=Q1` — Single teacher detail
- `POST /api/observations` — Create new observation
- `PUT /api/observations/:id` — Update observation
- `GET /api/rubric/sets` — List all rubric sets
- `GET /api/rubric/:setSlug` — Full rubric (categories + domains)
- `POST /api/rubric/:setSlug/categories` — Create category
- `PUT /api/rubric/categories/:id` — Update category
- `DELETE /api/rubric/categories/:id` — Delete category
- `POST /api/rubric/categories/:id/domains` — Create domain
- `PUT /api/rubric/domains/:id` — Update domain
- `DELETE /api/rubric/domains/:id` — Delete domain
- `GET /api/auth/google` — Start Google OAuth flow (redirect to Google)
- `GET /api/auth/google/callback` — OAuth callback (handled by passport)
- `GET /api/auth/me` — Returns current user JSON or 401
- `POST /api/auth/logout` — Destroys session, redirects to `/`
- `GET /api/people` — List people. COACH / SCHOOL_LEADER: own school. NETWORK_LEADER / NETWORK_ADMIN: all schools, or one via `?schoolId=`
- `POST /api/people` — Create a person (also opens an assignment for the active year)
- `POST /api/people/bulk` — CSV bulk import / re-assignment
- `PATCH /api/people/:employeeId` — Update a person
- `PATCH /api/people/:employeeId/toggle-active` — Soft-delete (blocks self-deactivation)
- `POST /api/people/:employeeId/reassign` — Move to a new role/school (NETWORK_ADMIN)
- `GET /api/district/summary?rubricSet=Q1` — Per-school aggregated domain averages (network scope)
- `GET /api/admin/schools` — Schools CRUD (NETWORK_ADMIN for writes)
- `GET /api/admin/school-years` — School-year CRUD + activation (NETWORK_ADMIN)
- `GET /api/action-center/rescore-queue` — People where needsRescore=true + school info + due date
- `GET /api/action-center/overdue-observations` — People not observed in 14+ days
- `GET /api/action-steps` — Action steps; `PATCH /api/action-steps/:id/master` to mark mastered
- `POST /api/ai/chat` · `/chat/stream` · `/analysis` · `/school-summary` — AI assistant (rate limited)
- `POST /api/auth/impersonate` · `/stop-impersonating` — NETWORK_ADMIN impersonation

### District Walkthrough + Action Center

- **`observations.isWalkthrough`** (boolean, DB column `is_walkthrough`) — marks an observation as a district walkthrough
- **`people.needsRescore`** (boolean, DB column `needs_rescore`) — set true when a published walkthrough's mean score is **< 0.7** (scores are 0 / 0.5 / 1.0, so 0.7 is the proficiency threshold). A walkthrough at or above 0.7 clears the flag.
- **`people.rescoreDueDate`** (date, DB column `rescore_due_date`) — 14 days after the walkthrough date
- **`people.rescoreSchoolYearId`** — scopes the flag to the school year it was raised in
- **Rescore logic**: `POST /api/observations` and `PUT /api/observations/:id` — fires when the observation is a published walkthrough and the creator is SCHOOL_LEADER, NETWORK_LEADER, or NETWORK_ADMIN
- **Dashboard `?walkthroughsOnly=true`** — filters to walkthrough-only observations
- **Action Center page** (`/action-center`) — rescore queue, overdue observations, and overdue action steps. Always scoped to one school at a time, so a Network Leader viewing a school sees the same thing that school's leader sees.

### Frontend Client (artifacts/catalyst-dashboard/src/)

- `lib/api.ts` — Typed fetch helpers for all API endpoints
- `context/UserContext.tsx` — UserProvider + useUser hook (loads the session from `/api/auth/me`)
- `components/Dashboard.tsx` — Main grid; routes network-scope users → DistrictDashboard; filters people by URL schoolId or currentUser.schoolId; includes "Walkthroughs Only" toggle
- `components/DistrictDashboard.tsx` — District-level school grid with per-school domain averages + drill-down
- `components/TeacherScoreOverlay.tsx` — Full teacher score overlay view
- `components/DrillDownModal.tsx` — Domain trend chart + observation list
- `components/NewObservationModal.tsx` — Observation entry form; walkthrough toggle for network-scope users
- `components/ObservationDetailModal.tsx` — View/edit individual observation
- `pages/admin.tsx` — Rubric Settings, Users, Schools, School Years, AI Quota, Notifications tabs; tab visibility is role-gated and COACH is blocked entirely
- `pages/action-center.tsx` — Rescore queue table with status badges and due dates
- `components/RichTextDisplay.tsx` — Renders stored glows/grows, sanitised with DOMPurify

### Vite Proxy

The frontend proxies `/api` to `http://localhost:8080` in development (configured in `vite.config.ts`).

### Email sending

Observation feedback is shared by **copy and paste only**. After saving an
observation, the preview offers a single **Copy Email** button that copies
formatted HTML for pasting into Outlook or any other mail client.

There is no automated sending, and no email service integration. The
server-side send route (`POST /api/email/send-observation`), the Resend client
wrapper, and the `resend` / `sanitize-html` dependencies were all removed —
the feature was never reachable from the UI and there are no plans to rebuild
it. The Replit Resend connector, if still configured, is unused and can be
disconnected.

**The email HTML is built entirely client-side** by `buildHtmlEmail()` in
`artifacts/catalyst-dashboard/src/components/NewObservationModal.tsx`. Nothing
about this flow touches the API server.

Because that function assembles a raw HTML string, every interpolated value
must stay escaped:
- `escapeEmailHtml()` — all plain fields (teacher name, course, observer,
  rubric category and domain labels, dates, grade levels).
- `sanitizeEmailRichText()` — TipTap rich text (glows, grows, action steps),
  reduced to a formatting-only tag allowlist via DOMPurify.

The preview iframe is sandboxed without `allow-scripts`, but treat that as a
backstop rather than the protection.

**If direct sending is ever wanted again**, the removed implementation is
recoverable from git history — it was deleted in the commit following
`6406c9a`:

```bash
git show 6406c9a:artifacts/api-server/src/routes/email.ts > email.ts
git show 6406c9a:artifacts/api-server/src/lib/resend.ts   > resend.ts
```

Five test files covering HTML injection, escaping, subject sanitisation,
observer naming, and school-scope authorisation were removed alongside it and
are recoverable from the same commit. Expect to rewrite rather than restore:
the Resend SDK and the surrounding schema will have moved on.

## Schools

Schools — including the Home Office pseudo-school that network-level accounts
must be assigned to — are created and edited **exclusively through the admin
UI** (Admin → Schools). No startup or deploy code seeds or modifies the
`schools` table. See `lib/db/README.md` for the history.

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server on port 8080. Routes in `src/routes/`:
- `health.ts` — GET /api/healthz
- `dashboard.ts` — GET /api/dashboard
- `teachers.ts` — GET /api/teachers/:id
- `observations.ts` — POST/PUT /api/observations
- `rubric.ts` — Full rubric CRUD

### `lib/db` (`@workspace/db`)

- `src/index.ts` — Pool + Drizzle instance
- `src/schema/` — All table definitions + relations
- `src/seed.ts` — Seeds demo people, rubric sets, and observations
- Run: `pnpm --filter @workspace/db run push` (push schema)
- Run: `cd lib/db && pnpm exec tsx src/seed.ts` (reseed)

## Authentication — Google OAuth 2.0 Setup

### Required Secrets

Set these in the Replit Secrets panel before login will work:

| Secret | Description |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth 2.0 Client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 Client Secret |
| `SESSION_SECRET` | Random string for signing express-session cookies (required in production) |

### Google Cloud Console Setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials
2. Create a new **OAuth 2.0 Client ID** (Application type: Web application)
3. Add to **Authorised JavaScript origins**: `https://<your-replit-dev-domain>`
4. Add to **Authorised redirect URIs**: `https://<your-replit-dev-domain>/api/auth/google/callback`
5. Copy the Client ID and Client Secret into Replit Secrets

The Replit dev domain is available in the environment as `$REPLIT_DEV_DOMAIN`.

### User Provisioning

Only users pre-provisioned in the `users` table can sign in. To add a user:
- Via Admin UI: Sign in as NETWORK_ADMIN → Admin → Users tab → Add User
- Via SQL: `INSERT INTO users (email, name, role) VALUES ('user@uncommonschools.org', 'Full Name', 'SCHOOL_LEADER')`
- Via seed: add to `artifacts/api-server/src/seed.ts` and re-run

On first login, the user's `google_id` is populated automatically.
