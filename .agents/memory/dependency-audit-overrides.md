---
name: Fixing pnpm audit findings
description: Only the root package.json override list is live; forcing a patched transitive can break a dependent that imports its internals, as undici >=7.29 did to jsdom 29.
---

## Rule
Two override lists exist and **only `pnpm.overrides` in the root `package.json` takes effect**. The `overrides:` block in `pnpm-workspace.yaml` is a stale subset — editing it does nothing.

**Why:** The lockfile header records the `package.json` block verbatim, in its exact order. That is how to confirm which list is live: `grep -n "^overrides:" -A 25 pnpm-lock.yaml` and compare. Anyone who edits the workspace YAML will watch their fix silently not apply.

## Rule
Prefer bumping the **direct dependent** over pinning a patched transitive with an override.

**Why:** An override forces a version the dependent was never tested against. Pinning `undici: '>=7.29.0'` to clear its advisory broke all 89 catalyst-mobile tests at collection, because jsdom 29 requires `undici/lib/handler/wrap-handler.js` — an internal path that moved in 7.29. The failure surfaced as `Test Files no tests` plus a `MODULE_NOT_FOUND` deep in jsdom's require stack; nothing in the error mentions the override, so it does not look like a dependency problem at all.

The fix was to drop the override and bump jsdom 29 -> 30, which depends on undici 8.x and is outside the advisory range entirely. Overrides are right for a transitive nobody imports internals from (`qs`, `postcss`, `nanoid`, `browserslist`); they are wrong when a dependent reaches past the public API.

**How to apply:**
- Run `pnpm audit` for the real list. Replit's scanner reports the same set from the same advisory database, so there is no need to work from its UI.
- Fix runtime dependencies first, dev and build tooling second, and commit them separately — the two halves carry very different risk.
- After any override change, run `pnpm run test`. Typecheck will not catch this class of break; it only appears at test collection or runtime.
- Severity labels mislead here. All 11 "Critical" rows in the 2026-09 sweep were `orval`, a code generator that only ever runs by hand.

## Rule
Bumping `orval` does not regenerate the API client, and should not.

**Why:** The generated client is committed. `pnpm --filter @workspace/api-spec run codegen` is manual, so a version bump alone leaves the committed output untouched and typecheck proves it still compiles. Regenerating across a jump like 8.5 -> 8.22 rewrites generated code and belongs in its own reviewable change.
