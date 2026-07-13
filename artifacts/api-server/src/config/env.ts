/**
 * Single authoritative source for environment-derived configuration.
 * All files that need to branch on NODE_ENV should import from here
 * rather than re-deriving process.env.NODE_ENV === "production" inline.
 */

export const isProduction: boolean = process.env.NODE_ENV === "production";
