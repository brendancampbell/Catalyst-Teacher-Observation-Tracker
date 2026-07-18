# Threat Model

## Project Overview

Catalyst is a publicly deployed principal observation platform for Uncommon Schools. It uses a TypeScript pnpm monorepo with an Express API (`artifacts/api-server`), PostgreSQL via Drizzle, a React/Vite dashboard (`artifacts/catalyst-dashboard`), and a mobile-oriented React client (`artifacts/catalyst-mobile`). Authentication is Google OAuth through Passport with server-side sessions stored in PostgreSQL. The production deployment is public at `https://catalyst.uncommonschools.org`.

Production scope for this scan is the API server plus the Catalyst dashboard and Catalyst mobile clients. Legacy or experimental artifacts such as `artifacts/mockup-sandbox` should be treated as dev-only unless production reachability is demonstrated. Assume `NODE_ENV=production` in deployed environments.

Current production account-management logic also enforces an important scoping invariant: `NETWORK_LEADER` and `NETWORK_ADMIN` accounts are expected to be assigned to the Home Office school rather than to region schools. Findings that depend on unsupported out-of-band rows for school-assigned network users should be treated as out of scope unless production reachability is demonstrated through a real application flow.

## Assets

- **User accounts and sessions** — Google-authenticated staff sessions, role assignments, impersonation state, and school/network scope. Compromise allows access to sensitive staff performance data and privileged admin functions.
- **Observation records** — classroom observations, rubric scores, strengths, growth areas, walkthrough flags, audit fields, and derived rescore status. These records are operationally sensitive personnel-performance data.
- **People and school directory data** — employee IDs, names, emails, school assignments, departments, grade levels, and active/inactive state. Exposure enables unauthorized profiling and targeted phishing.
- **Administrative configuration** — schools, rubric sets, rubric categories/domains, user and people management, and network-wide reporting surfaces. Tampering can corrupt evaluation workflows across multiple campuses.
- **Outbound integration secrets and service access** — Google OAuth credentials, session secret, database credentials, Anthropic access, and Resend connector data. Compromise could enable impersonation, data extraction, or abuse of external services.

## Trust Boundaries

- **Browser/mobile client to API** — all client input is untrusted, including query params, JSON bodies, copied rich text, and school-selection parameters.
- **API to PostgreSQL** — the API has broad access to staff, observation, chat, and session data. Authorization bugs or injection at the API layer can expose or alter high-value records.
- **API to third-party services** — the server calls Google OAuth, Anthropic, and Resend using privileged credentials. Requests crossing this boundary must be scoped and validated.
- **Public to authenticated boundary** — `/api/auth/google`, `/api/auth/google/callback`, and `/api/app` are public; nearly all other `/api/*` routes assume an authenticated session cookie.
- **Authenticated to privileged boundary** — role separation between COACH, SCHOOL_LEADER, NETWORK_LEADER, and NETWORK_ADMIN must be enforced server-side on every sensitive route.
- **Revoked-user boundary** — disabling a user or downgrading them to `NO_ACCESS` must immediately prevent session re-use. Stale sessions should never continue to load privileged identity or fall through to broader data scope.
- **Primary user to impersonated user boundary** — impersonation changes the effective identity for downstream authorization and must never let an attacker or lower-privileged user act outside approved scope.

## Scan Anchors

- Production API entry points: `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/routes/index.ts`
- Highest-risk code areas: `routes/auth.ts`, `routes/observations.ts`, `routes/email.ts`, `routes/ai.ts`, `routes/people.ts`, `lib/passport.ts`, `middleware/auth.ts`, `artifacts/catalyst-dashboard/src/pages/drafts.tsx`, and frontend rich-text/navigation sinks
- Public surfaces: `/api/auth/google`, `/api/auth/google/callback`, `/api/app`
- Authenticated surfaces: dashboard, teacher, observation, people, AI, email, impersonation, admin-school routes
- Expensive external-service surfaces: `/api/ai/chat`, `/api/ai/chat/stream`, `/api/ai/analysis`, `/api/ai/school-summary`, `/api/qualitative-themes/generate`, `/api/email/send-observation`
- Dev-only or currently unreachable areas usually ignored unless proven reachable: `artifacts/mockup-sandbox`, legacy GBF rename paths beyond the explicit redirect in `app.ts`, unmounted route files such as `artifacts/api-server/src/routes/users.ts`, and hypothetical school-assigned `NETWORK_LEADER` / `NETWORK_ADMIN` rows that current production account-management flows no longer create

## Threat Categories

### Spoofing

The application relies on Google OAuth plus server-side sessions. The system must only create sessions for pre-provisioned active users, must bind impersonation to authorized NETWORK_ADMIN actions, must reject session reuse after deactivation or downgrade to `NO_ACCESS`, and must ensure session state cannot be forged or reused across users.

### Tampering

Authenticated users can create and edit observations, people, users, schools, rubrics, and AI chat state. The server must validate all user-controlled fields, reject unauthorized cross-school or cross-role mutations, and prevent cross-site request forgery against any cookie-authenticated state-changing endpoint.

### Information Disclosure

Observation history, rubric notes, teacher/staff contact details, and network-wide analytics are sensitive personnel data. Every read path and every outbound sharing path must enforce school/network scope server-side, and rendered rich text or error responses must not leak more data than the caller is entitled to access. Historical observations must remain bound to the school and publication state they were created under; a later teacher transfer or AI aggregation helper must not surface prior-school records or another observer's drafts. Outbound email templates must not embed caller-selected third-party image URLs, because opening a trusted message would leak recipient metadata to external domains.

### Denial of Service

Public auth entry points and authenticated AI or email endpoints can trigger external-service work. The application must avoid unbounded expensive operations, especially on AI generation and email sending, and should not allow an attacker to create excessive sessions or outbound workload through repeated authenticated requests. Authenticated AI endpoints in particular should enforce per-user rate limits or quotas because each request can trigger substantial database reads plus Anthropic model usage.

### Elevation of Privilege

The most important risks are broken access control across school/network boundaries, insecure impersonation behavior, stale-session access after revocation, client-side code execution through untrusted navigation or rendered observation content, and any route that lets a lower-privileged user act on behalf of a more privileged workflow. All privileged actions must be enforced on the server rather than hidden only in the UI.
