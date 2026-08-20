/**
 * Types for source-fingerprint.mjs.
 *
 * Hand-written because the module is plain ESM that both build.mjs (a node
 * script, no TypeScript) and a TypeScript test need to import. Declaring it
 * here keeps the .mjs out of the api-server compilation, which has
 * rootDir: "src" and would otherwise reject a file above it.
 */

/** A 16-hex-char digest of every bundled .ts file's path and contents. */
export function sourceFingerprint(repoRoot?: string): string;
