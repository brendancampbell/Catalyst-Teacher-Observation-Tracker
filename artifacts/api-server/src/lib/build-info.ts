/**
 * Which source snapshot this process was built from.
 *
 * `pnpm run dev` is `build && start`, so a running server is a compiled
 * snapshot that never picks up a later edit. Nothing about it otherwise says
 * which snapshot it is, which is how test runs ended up pointed at a server
 * that predated the change they were testing.
 *
 * esbuild replaces __BUILD_FINGERPRINT__ at build time (see build.mjs). The
 * typeof guard is for the paths where it never gets replaced — tsx running a
 * source file directly — where referencing it bare would be a ReferenceError.
 */

declare const __BUILD_FINGERPRINT__: string | undefined;

export const BUILD_FINGERPRINT: string =
  typeof __BUILD_FINGERPRINT__ === "string" ? __BUILD_FINGERPRINT__ : "unbuilt";
