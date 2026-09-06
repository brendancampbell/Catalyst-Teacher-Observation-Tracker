---
name: Fail-open authorization patterns
description: Two shipped bugs had the same shape — a check that reads as safe but grants access when a value is missing. Where they were, and how to spot the next one.
---

## Rule
A check that decides access must be written so that a **missing value denies**. Two separate bugs (fixed 2026-09-06, PR #14) were the same mistake in different clothes.

**Why:** Both read as correct at a glance. Neither failed any test. Both granted access precisely when information was absent — which is the moment you least want to be permissive.

### Shape 1 — comparing two things that can both be null

`routes/teachers.ts` gated school access on:

```ts
person.schoolId !== currentUser.schoolId   /* fail-OPEN */
```

When both sides are null the comparison is false, so a caller with no school reached every person with no school. Two lines on, the observation filter was applied only `if (currentUser.schoolId !== null)`, so the same caller got that person's observations from **every** school.

Use `canAccessSchoolScopedRecord(user, record.schoolId)` for the record comparison and `effectiveSchoolId(user)` for the query scope. `effectiveSchoolId` throws `NoSchoolAssignedError` for a school-scoped user with no school and returns null *only* for network roles — so `null` unambiguously means "all schools" rather than "no information".

Null schoolId is reachable, not theoretical: `people.school_id` is declared `onDelete: "set null"`, so deleting one school nulls it for everyone assigned to it at once.

### Shape 2 — negating the safe state instead of naming the dangerous one

Every development affordance was gated on `!isProduction`, which is true for unset, `"prod"`, `"Production"` — anything but the exact string. A deploy that lost `NODE_ENV` would have enabled the `/api/auth/dev-login` bypass (log in as any employee, no password), the seed routes, the hardcoded session secret, insecure cookies, and the header-less CSRF pass, all silently and all at once.

Gate on `isDevelopment` (exactly `"development"`) instead. Name the permissive state explicitly; never derive it by negating the restrictive one.

**How to apply:**
- When reviewing an access check, substitute null/undefined/unset for each input and ask what happens. If the answer is "access granted", it is fail-open.
- Route mounting is half the story. `/api/dashboard` was safe from Shape 1 only because it is mounted behind `enforceSchoolScope`; `/api/teachers` is mounted with `requireAuth` alone, so the handler owned the whole check. Read `routes/index.ts` before trusting a handler.
- Guard both with tests: `test-teachers-cross-school-auth.ts` covers the null cases, and `test-node-env-fail-closed.ts` includes a source-level assertion that no call site reintroduces a `!isProduction` gate.
- Dependency scanners do not find any of this. See [[dependency-audit-overrides]] for that separate sweep.
