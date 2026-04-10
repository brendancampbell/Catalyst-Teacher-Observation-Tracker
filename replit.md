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
- **User Permissions / RBAC**: Roles: COACH, PRINCIPAL, NETWORK_LEADER, DISTRICT_ADMIN
  - COACH: school-based, can view school data + create observations; no admin access
  - PRINCIPAL (School Leader): school-based, can view school data + create observations + edit school settings (roster)
  - NETWORK_LEADER: network-based (no schoolId), sees district view + can create obs + edit school settings (roster); NO network settings (rubric/schools)
  - DISTRICT_ADMIN (Super Admin): network-based, full access to all views and all settings
  - User switcher dropdown in header (persists to localStorage)
  - Admin button hidden from COACH role
  - Admin page blocked for COACH (shows Access Restricted screen)
  - Walkthrough toggle shown to PRINCIPAL | NETWORK_LEADER | DISTRICT_ADMIN
- **Teacher Roster** (Admin > Teacher Roster tab): Add, Edit, Deactivate teachers; show/hide inactive

### Design

- **Brand colors**: Navy `#1034B4`, Yellow `#FFB500`
- **Fonts**: Bebas Neue (headlines, stats, buttons), Libre Franklin (body)
- Score colors: Green (≥0.7 = Proficient), Yellow (≥0.5 = Developing), Red (<0.5 = Not Yet)
- Scoring scale: 0 (Not Yet) / 0.5 (Developing) / 1.0 (Proficient)

### Database Schema (lib/db/src/schema/)

- `users` — id, email, name, role (COACH | PRINCIPAL | NETWORK_LEADER | DISTRICT_ADMIN)
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
- `GET /api/users` — List all users with schoolId + schoolName (for role switcher)
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
