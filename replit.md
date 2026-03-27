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

A principal observation tracker for Uncommon Schools. Principals log classroom observations for 20 teachers, scoring them on 10 rubric domains across 3 categories. The dashboard shows most-recent or quarter-average scores for all teachers in a color-coded grid.

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
- "Add Observation" modal with all 10 domains scored 1–4
- Admin rubric manager for managing categories and domains
- **User Permissions / RBAC**: Roles: COACH, PRINCIPAL, DISTRICT_ADMIN
  - User switcher dropdown in header (persists to localStorage)
  - Admin button hidden from COACH role
  - Admin page blocked for COACH (shows Access Restricted screen)
- **Teacher Roster** (Admin > Teacher Roster tab): Add, Edit, Deactivate teachers; show/hide inactive

### Design

- **Brand colors**: Navy `#1034B4`, Yellow `#FFB500`
- **Fonts**: Bebas Neue (headlines, stats, buttons), Libre Franklin (body)
- Score colors: Green (4=exemplary), Light green (3=proficient), Yellow (2=approaching), Red (1=needs improvement)

### Database Schema (lib/db/src/schema/)

- `users` — id, email, name, role (COACH | PRINCIPAL | DISTRICT_ADMIN)
- `teachers` — id, name, subject, gradeLevel (text[]), isActive (bool)
- `rubric_quarters` — id, slug (Q1), name, isActive
- `rubric_categories` — id, quarterId, name, displayOrder
- `rubric_domains` — id, categoryId, name, slug, displayOrder
- `observations` — id, teacherId, quarterId, observerId (FK→users), date, strengths, growthAreas, observer
- `observation_scores` — id, observationId, domainSlug, score (1–4)

### API Endpoints (artifacts/api-server/)

All routes mounted at `/api`:

- `GET /api/dashboard?quarter=Q1` — Full dashboard data (active teachers only + observations)
- `GET /api/teachers/:id?quarter=Q1` — Single teacher detail
- `POST /api/observations` — Create new observation
- `PUT /api/observations/:id` — Update observation
- `GET /api/rubric/quarters` — List all quarters
- `GET /api/rubric/:quarterSlug` — Full rubric (categories + domains)
- `POST /api/rubric/:quarterSlug/categories` — Create category
- `PUT /api/rubric/categories/:id` — Update category
- `DELETE /api/rubric/categories/:id` — Delete category
- `POST /api/rubric/categories/:id/domains` — Create domain
- `PUT /api/rubric/domains/:id` — Update domain
- `DELETE /api/rubric/domains/:id` — Delete domain
- `GET /api/users` — List all users with schoolId + schoolName (for role switcher)
- `GET /api/district/summary?quarter=Q1` — Per-school aggregated domain averages (DISTRICT_ADMIN)
- `GET /api/admin/teachers` — All teachers incl. inactive (admin roster)
- `POST /api/admin/teachers` — Create teacher
- `PATCH /api/admin/teachers/:id` — Update teacher name/subject/gradeLevel
- `PATCH /api/admin/teachers/:id/toggle-active` — Toggle isActive

### Frontend Client (artifacts/gbf-dashboard/src/)

- `lib/api.ts` — Typed fetch helpers for all API endpoints
- `context/UserContext.tsx` — UserProvider + useUser hook (role switcher, localStorage persist)
- `components/Dashboard.tsx` — Main grid; routes DISTRICT_ADMIN (no schoolId) → DistrictDashboard; filters teachers by URL schoolId or currentUser.schoolId
- `components/DistrictDashboard.tsx` — District-level school grid with per-school domain averages + drill-down
- `components/TeacherProfile.tsx` — Full teacher view
- `components/DrillDownModal.tsx` — Domain trend chart + observation list
- `components/NewObservationModal.tsx` — Observation entry form
- `components/ObservationDetailModal.tsx` — View/edit individual observation
- `pages/admin.tsx` — Rubric Settings + Teacher Roster tabs; RBAC block for COACH
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
