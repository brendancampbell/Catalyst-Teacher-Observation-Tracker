/**
 * Carry the school you are looking at across a navigation.
 *
 * The Action Center scopes itself to `?schoolId`, and falls back to the
 * signed-in person's OWN school when it is absent. For a school leader those
 * are the same thing, so the omission is invisible. For a network admin, whose
 * own school is Home Office, following a link without it lands on an Action
 * Center for Home Office — network staff listed as though they were teachers
 * to observe.
 *
 * Built from the current URL rather than from props: whoever navigated here
 * already put the school in it, and reading it back is one source instead of
 * every page remembering to thread three parameters through.
 */
export function schoolContextParams(fallbackSchoolId?: number | null): URLSearchParams {
  const current = new URLSearchParams(window.location.search);
  const out = new URLSearchParams();

  const schoolId = current.get("schoolId")
    ?? (fallbackSchoolId != null ? String(fallbackSchoolId) : null);
  if (schoolId) out.set("schoolId", schoolId);

  /* Carried only for the header's title — the server scopes on the id alone. */
  for (const key of ["schoolName", "schoolAbbreviation"]) {
    const v = current.get(key);
    if (v) out.set(key, v);
  }
  return out;
}

/** An Action Center link that stays on the school you are looking at. */
export function actionCenterHref(
  basePath: string,
  returnTo: string,
  fallbackSchoolId?: number | null,
): string {
  const params = schoolContextParams(fallbackSchoolId);
  params.set("returnTo", returnTo);
  return `${basePath}/action-center?${params.toString()}`;
}
