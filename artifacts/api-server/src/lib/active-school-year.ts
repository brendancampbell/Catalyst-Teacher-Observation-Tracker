import { db } from "@workspace/db";
import { schoolYears } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

let _cachedId: number | null | undefined = undefined;
let _cacheExpiry = 0;
const CACHE_TTL = 60_000;

/**
 * Returns the active school year id, cached for 60 s.
 * Returns null if no school year has status = 'active'.
 */
export async function getActiveSchoolYearId(): Promise<number | null> {
  if (_cachedId !== undefined && Date.now() < _cacheExpiry) return _cachedId;
  const [row] = await db
    .select({ id: schoolYears.id })
    .from(schoolYears)
    .where(eq(schoolYears.status, "active"))
    .limit(1);
  _cachedId = row?.id ?? null;
  _cacheExpiry = Date.now() + CACHE_TTL;
  return _cachedId;
}

/** Bust the in-memory cache (call after updating school_years.status). */
export function invalidateActiveSchoolYearCache(): void {
  _cachedId = undefined;
  _cacheExpiry = 0;
}
