import type { QueryClient } from "@tanstack/react-query";
import type { DashboardData } from "@workspace/api-types";
import { QUERY_KEYS } from "@/lib/queryKeys";

/**
 * Take a deleted observation out of a dashboard payload.
 *
 * Invalidating the query is the truthful thing to do, but it is not the
 * immediate thing: the refetch is a round trip, and until it lands the screen
 * still shows the observation somebody just deleted. A principal reported
 * exactly that — the row stayed until he refreshed the page.
 *
 * So the deletion is applied to the cached copy first and the refetch confirms
 * it. Every list on the dashboard is derived from this payload — the grid, the
 * drill-down, the teacher profile's history — so removing it here removes it
 * everywhere at once, and the score averages, which are computed client-side
 * from these same observations, correct themselves in the same render.
 *
 * Returns the original object when nothing matched, so React Query can skip a
 * pointless re-render.
 */
export function withoutObservation(data: DashboardData, observationId: string): DashboardData {
  let hit = false;

  const teachers = data.teachers.map((t) => {
    if (!t.observations.some((o) => o.id === observationId)) return t;
    hit = true;
    return { ...t, observations: t.observations.filter((o) => o.id !== observationId) };
  });

  return hit ? { ...data, teachers } : data;
}

/**
 * Drop a deleted observation from every cached dashboard, whatever rubric set,
 * school or walkthrough filter it was fetched under.
 *
 * Deliberately applied to all of them rather than the one on screen: the
 * others are still in cache and would otherwise serve the deleted observation
 * back the moment somebody switched rubric or toggled the walkthrough view.
 */
export function removeObservationFromDashboards(
  queryClient: QueryClient,
  observationId: string,
): void {
  queryClient.setQueriesData<DashboardData>(
    { queryKey: QUERY_KEYS.dashboard },
    (old) => (old ? withoutObservation(old, observationId) : old),
  );
}
