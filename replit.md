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
- `/admin` — Rubric manager (add/edit/delete categories and domains)

### Features

- Real-time data from PostgreSQL via Express API
- 20 seeded teachers with 3 observations each (Q1 2026 data)
- Filter by department, grade level, experience, or search by name
- "Most Recent" vs "Quarter Average" toggle
- Click any teacher name → full profile view
- Click any score cell → drill-down with trend chart
- "Add Observation" modal with all 10 domains scored 1–4
- Admin rubric manager for managing categories and domains

### Design

- **Brand colors**: Navy `#1034B4`, Yellow `#FFB500`
- **Fonts**: Bebas Neue (headlines, stats, buttons), Libre Franklin (body)
- Score colors: Green (4=exemplary), Light green (3=proficient), Yellow (2=approaching), Red (1=needs improvement)

### Database Schema (lib/db/src/schema/)

- `teachers` — id, name, department, gradeLevel, yearsExperience
- `rubric_quarters` — id, slug (Q1), name, isActive
- `rubric_categories` — id, quarterId, name, displayOrder
- `rubric_domains` — id, categoryId, name, slug, displayOrder
- `observations` — id, teacherId, quarterId, date, strengths, growthAreas, observer
- `observation_scores` — id, observationId, domainSlug, score (1–4)

### API Endpoints (artifacts/api-server/)

All routes mounted at `/api`:

- `GET /api/dashboard?quarter=Q1` — Full dashboard data (rubric + all teachers + observations)
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

### Frontend Client (artifacts/gbf-dashboard/src/)

- `lib/api.ts` — Typed fetch helpers for all API endpoints
- `components/Dashboard.tsx` — Main grid with useQuery + filters + modals
- `components/TeacherProfile.tsx` — Full teacher view
- `components/DrillDownModal.tsx` — Domain trend chart + observation list
- `components/NewObservationModal.tsx` — Observation entry form
- `components/ObservationDetailModal.tsx` — View/edit individual observation
- `pages/admin.tsx` — Rubric CRUD manager
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
