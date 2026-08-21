/**
 * Shared constants for rubric-set enforcement.
 *
 * The number itself lives in @workspace/api-types so the API and the admin
 * screen cannot disagree about it — they have, twice. This re-export keeps the
 * existing import path working for the routes and tests that use it.
 */

export { MAX_ACTIVE_RUBRIC_SETS as MAX_ACTIVE_SETS } from "@workspace/api-types";
