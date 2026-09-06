/**
 * Single authoritative source for environment-derived configuration.
 * All files that need to branch on NODE_ENV should import from here
 * rather than re-deriving process.env.NODE_ENV === "production" inline.
 */

const nodeEnv = process.env.NODE_ENV;

export const isProduction: boolean = nodeEnv === "production";

/**
 * Explicitly development, rather than "not production".
 *
 * Every dangerous development affordance — the dev-login auth bypass, the
 * seed routes, the plaintext session cookie, the hardcoded session secret
 * fallback — must key off THIS, never off `!isProduction`.
 *
 * The difference is what happens when NODE_ENV is unset or misspelled.
 * `!isProduction` is true in that case, so a deploy that lost the variable
 * would silently enable an endpoint that logs anyone in as any employee.
 * `isDevelopment` is false, so the same mistake fails closed: the bypass
 * stays unregistered and the cookie stays secure. The dev experience is
 * unchanged because `pnpm dev` and scripts/test-db.sh both export
 * NODE_ENV=development explicitly.
 */
export const isDevelopment: boolean = nodeEnv === "development";

/**
 * Neither value set. The process still starts — a missing NODE_ENV is not
 * worth refusing to boot over now that the defaults above are safe — but it
 * is logged loudly at startup because it means someone lost the variable.
 */
export const isUnknownEnv: boolean = !isProduction && !isDevelopment;

export const nodeEnvLabel: string = nodeEnv && nodeEnv.length > 0 ? nodeEnv : "(unset)";
