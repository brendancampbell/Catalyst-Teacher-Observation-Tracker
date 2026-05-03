# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Contains the **GBF Principal Dashboard** for Uncommon Schools — a full-stack principal observation tracker.

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
│   └── gbf-dashboard/       # React + Vite frontend
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

## GBF Principal Dashboard

### Application Overview

A principal observation tracker for Uncommon Schools. Principals log classroom observations for 20 teachers, scoring them on rubric domains across 3 categories. The dashboard shows most-recent or period-average scores for all teachers in a color-coded grid with category sub-averages and a Proficient column.

### Key Pages

- `/` — Main dashboard grid (observation tracker)
- `/admin` — Admin settings (Rubric Manager + Teacher Roster; COACH role blocked)

### Features

- Real-time data from PostgreSQL via Express API
- 20 seeded teachers with 3 observations each (Q1 2026 data)
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
  - NETWORK_LEADER: network-based (no schoolId), sees district view + can create obs + edit school settings (roster); NO network settings (rubric/schools)
  - NETWORK_ADMIN (Super Admin): network-based, full access to all views and all settings
  - Authentication: Google OAuth 2.0 (passport.js) — only pre-provisioned emails can sign in
  - Admin button hidden from COACH role
  - Admin page blocked for COACH (shows Access Restricted screen)
  - Walkthrough toggle shown to SCHOOL_LEADER | NETWORK_LEADER | NETWORK_ADMIN
- **Teacher Roster** (Admin > Teacher Roster tab): Add, Edit, Deactivate teachers; show/hide inactive

### Design

- **Brand colors**: Navy `#1034B4`, Yellow `#FFB500`
- **Fonts**: Bebas Neue (headlines, stats, buttons), Libre Franklin (body)
- Score colors: Green (≥0.7 = Proficient), Yellow (≥0.5 = Developing), Red (<0.5 = Not Yet)
- Scoring scale: 0 (Not Yet) / 0.5 (Developing) / 1.0 (Proficient)

### Database Schema (lib/db/src/schema/)

- `users` — id, email, name, role (COACH | SCHOOL_LEADER | NETWORK_LEADER | NETWORK_ADMIN), schoolId (FK), googleId (text, set on first Google login)
- `teachers` — id, name, subject, gradeLevel (text[]), isActive (bool)
- `rubric_sets` — id, slug (Q1), name, isActive, gradeSpan (nullable)
- `rubric_categories` — id, rubricSetId, name, displayOrder
- `rubric_domains` — id, categoryId, name, slug, displayOrder
- `observations` — id, teacherId, rubricSetId, observerId (FK→users), date, strengths, growthAreas, observer
- `observation_scores` — id, observationId, domainSlug, score (real: 0 / 0.5 / 1.0)

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
- `GET /api/users` — List users (SCHOOL_LEADER: own school only; NETWORK_ADMIN: all)
- `POST /api/users` — Provision new user
- `PATCH /api/users/:id` — Update user
- `GET /api/district/summary?rubricSet=Q1` — Per-school aggregated domain averages (DISTRICT_ADMIN)
- `GET /api/admin/teachers` — All teachers incl. inactive (admin roster)
- `POST /api/admin/teachers` — Create teacher
- `PATCH /api/admin/teachers/:id` — Update teacher name/subject/gradeLevel
- `PATCH /api/admin/teachers/:id/toggle-active` — Toggle isActive
- `GET /api/action-center/rescore-queue` — Teachers where needsRescore=true + school info + due date

### Phase 5 Features (District Walkthrough + Action Center)

- **`observations.isWalkthrough`** (boolean, DB column `is_walkthrough`) — marks an observation as a district walkthrough
- **`teachers.needsRescore`** (boolean, DB column `needs_rescore`) — set true when district walkthrough avg < 3.0
- **`teachers.rescoreDueDate`** (date, DB column `rescore_due_date`) — 14 days after the walkthrough date
- **Rescore logic**: POST /api/observations — if `isWalkthrough=true` and `observerId` resolves to DISTRICT_ADMIN, auto-flags teacher
- **Dashboard `?walkthroughsOnly=true`** — filters to walkthrough-only observations
- **Action Center page** (`/action-center`) — rescore queue table with due date status
- **NewObservationModal walkthrough toggle** — shown only to DISTRICT_ADMIN users

### Frontend Client (artifacts/gbf-dashboard/src/)

- `lib/api.ts` — Typed fetch helpers for all API endpoints
- `context/UserContext.tsx` — UserProvider + useUser hook (role switcher, localStorage persist)
- `components/Dashboard.tsx` — Main grid; routes DISTRICT_ADMIN (no schoolId) → DistrictDashboard; filters teachers by URL schoolId or currentUser.schoolId; includes "Walkthroughs Only" toggle
- `components/DistrictDashboard.tsx` — District-level school grid with per-school domain averages + drill-down
- `components/TeacherProfile.tsx` — Full teacher view
- `components/DrillDownModal.tsx` — Domain trend chart + observation list
- `components/NewObservationModal.tsx` — Observation entry form; district walkthrough toggle for DISTRICT_ADMIN
- `components/ObservationDetailModal.tsx` — View/edit individual observation
- `pages/admin.tsx` — Rubric Settings + Teacher Roster tabs; RBAC block for COACH
- `pages/action-center.tsx` — Rescore queue table with status badges and due dates
- `data/dummy.ts` — Type definitions + helper functions (data now comes from API)

### Vite Proxy

The frontend proxies `/api` to `http://localhost:8080` in development (configured in `vite.config.ts`).

### Email sending

Direct email send via Resend is **currently disabled** in the UI because the Resend sending domain has not been verified yet. The green "✉ Send Email" button is hidden in the post-save observation preview.

Principals send observation feedback to teachers using the still-visible buttons:
- **Open in Outlook** / **Outlook Web** — opens the principal's mail client with the subject and plain-text body pre-filled.
- **Copy HTML** / **Copy Text** — copies the formatted email for pasting into any mail tool.

All backend email plumbing remains intact and is not stubbed:
- `artifacts/api-server/src/routes/email.ts` — `POST /api/email/send-observation` (still mounted, just no UI caller).
- `artifacts/api-server/src/lib/resend.ts` — Resend client wrapper using the Replit Resend connector.
- `sendObservationEmail()` in `artifacts/gbf-dashboard/src/lib/api.ts` — frontend API call.
- `handleSendEmail()` in `NewObservationModal.tsx` — frontend handler.

**To re-enable direct send when Resend is ready:**
1. Verify the sending domain (e.g. `uncommonschools.org` or a subdomain) in the Resend dashboard.
2. Confirm the Replit Resend connector's `from_email` matches the verified domain.
3. In `artifacts/gbf-dashboard/src/components/NewObservationModal.tsx`, change `const EMAIL_DIRECT_SEND_ENABLED = false;` (top of file) to `true`.
4. Restart the `artifacts/gbf-dashboard: web` workflow.

No backend or schema changes are required to flip it back on.

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
- `src/seed.ts` — Seeds 20 teachers + Q1 rubric + 60 observations
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

## Pending Production Migration: teacher email NOT NULL

The `teachers.email` column is currently **nullable + unique** in the schema. This is a temporary state to allow the production deploy to succeed (production has 80 existing teachers with no email).

Three-step rollout:

1. ✅ **Done (current).** Schema relaxed to `text("email").unique()`. Deploy this. The post-deploy migration on production will:
   - `ALTER TABLE teachers ADD COLUMN email TEXT` (nullable — succeeds despite existing rows)
   - `ALTER TABLE teachers ADD CONSTRAINT teachers_email_unique UNIQUE (email)` (succeeds; multiple NULLs allowed in unique indexes)

2. **Backfill (manual, post-deploy).** Populate emails for the 80 existing teachers via:
   - Admin UI → Teachers tab → edit each, OR
   - Admin UI → Teachers tab → CSV bulk import (already validates email present + uniqueness)
   - Verify with: `SELECT COUNT(*) FILTER (WHERE email IS NULL) FROM teachers;` (should be 0)

3. **Tighten back to NOT NULL (follow-up deploy).** Change `lib/db/src/schema/teachers.ts` line 12 back to `text("email").notNull().unique()` and push. This will succeed only if step 2 left zero NULL rows.

App-level validation in `admin-teachers.ts` already requires email on create/edit/CSV import, so no new teachers can be added without one — only the legacy 80 rows are temporarily allowed to have NULL.
