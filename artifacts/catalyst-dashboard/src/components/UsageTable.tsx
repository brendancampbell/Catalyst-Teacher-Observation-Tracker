import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarRange, Search } from "lucide-react";
import { fetchUsage } from "@/lib/api";
import type { UsageRow } from "@workspace/api-types";

const NAVY   = "#1034b4";
const YELLOW = "#F5B729";

type SortKey = "name" | "role" | "schoolName" | "lastUsed" | "daysUsed" | "observations" | "actionSteps";

/**
 * Who is using Catalyst, and how much — a sub-tab of Intervention.
 *
 * ── Why it says "whole school year" so loudly ─────────────────────────────
 * Every other Intervention sub-tab shows a queue: what is outstanding right
 * now. This one shows totals accumulated since the year began. Read with the
 * others' habit of mind, "12 observations" looks like twelve things needing
 * attention rather than twelve already done, so the banner says which it is.
 *
 * ── Two numbers that are not what they look like ──────────────────────────
 * "Days used" is not sign-ins. Sessions last a week, so someone opening
 * Catalyst daily authenticates about four times a month — counting sign-ins
 * would show the most active person in the network as barely present.
 *
 * "Action steps" includes extensions: revisiting a step with a teacher is
 * coaching work even though it creates no new step. The header says so,
 * because otherwise a coach who extended one step twelve times reads the same
 * as one who set twelve different ones.
 */
export function UsageTable({ schoolId }: { schoolId?: number | null }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["usage", schoolId ?? null],
    queryFn:  () => fetchUsage(schoolId),
    staleTime: 60_000,
  });

  const [sortKey, setSortKey] = useState<SortKey>("daysUsed");
  const [ascending, setAscending] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [schoolFilter, setSchoolFilter] = useState<string>("");

  const rows = data?.rows ?? [];

  /* Filter options come from the rows themselves, so they always match what
     the viewer is allowed to see — a school user never sees another school
     in the dropdown. */
  const roles   = useMemo(() => [...new Set(rows.map((r) => r.role))].sort(), [rows]);
  const schools = useMemo(
    () => [...new Set(rows.map((r) => r.schoolName).filter(Boolean) as string[])].sort(),
    [rows],
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = rows.filter((r) =>
      (!term || r.name.toLowerCase().includes(term)) &&
      (!roleFilter || r.role === roleFilter) &&
      (!schoolFilter || r.schoolName === schoolFilter));

    return [...filtered].sort((a, b) => {
      const dir = ascending ? 1 : -1;
      const av = a[sortKey], bv = b[sortKey];
      /* Never-used sorts as the lowest value rather than dropping out — the
         people who have not touched it are the point of the report. */
      if (av === null && bv === null) return 0;
      if (av === null) return -1 * dir;
      if (bv === null) return 1 * dir;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, search, roleFilter, schoolFilter, sortKey, ascending]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) { setAscending((p) => !p); return; }
    setSortKey(key);
    /* Numbers open biggest-first, names A-Z — what you want in each case. */
    setAscending(key === "name" || key === "role" || key === "schoolName");
  }

  const showSchool = schools.length > 1;

  const Header = ({ k, label, help }: { k: SortKey; label: string; help?: string }) => (
    <th
      className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide cursor-pointer select-none whitespace-nowrap"
      style={{ color: sortKey === k ? NAVY : "#64748b" }}
      onClick={() => toggleSort(k)}
      title={help}
    >
      {label}{sortKey === k ? (ascending ? " ▲" : " ▼") : ""}
    </th>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="inline-block w-8 h-8 rounded-full border-4 border-blue-200 animate-spin" style={{ borderTopColor: NAVY }} />
      </div>
    );
  }
  if (error) {
    return <p className="px-6 py-8 text-sm text-red-600">Could not load usage: {(error as Error).message}</p>;
  }

  return (
    <div className="flex-1 overflow-auto px-4 sm:px-6 py-4 flex flex-col gap-3">

      {/* The whole point of the banner: every other sub-tab is a queue. */}
      <div
        className="flex items-start gap-2 px-3 py-2 rounded text-xs"
        style={{ backgroundColor: "#EFF6FF", border: "1px solid #BFDBFE", color: "#1E40AF" }}
      >
        <CalendarRange size={14} className="shrink-0 mt-0.5" />
        <p>
          <strong>This tab covers the whole school year{data?.schoolYear ? ` (${data.schoolYear})` : ""}</strong>,
          not what is outstanding right now. Everything else under Intervention shows work still to do;
          these are totals since the year began.
          {data?.recordingSince && (
            <> Day-by-day use has only been recorded since {data.recordingSince}, so “last used” and “days used”
            start from then. Observations and action steps cover the full year.</>
          )}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name"
            aria-label="Search by name"
            className="border border-slate-200 rounded pl-7 pr-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          aria-label="Filter by role"
          className="border border-slate-200 rounded px-2 py-1.5 text-sm bg-white"
        >
          <option value="">All roles</option>
          {roles.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
        </select>
        {showSchool && (
          <select
            value={schoolFilter}
            onChange={(e) => setSchoolFilter(e.target.value)}
            aria-label="Filter by school"
            className="border border-slate-200 rounded px-2 py-1.5 text-sm bg-white"
          >
            <option value="">All schools</option>
            {schools.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <span className="text-xs text-slate-500 ml-auto">
          {visible.length} of {rows.length} {rows.length === 1 ? "person" : "people"}
        </span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead style={{ backgroundColor: "#F8FAFC", borderBottom: "1px solid #e2e8f0" }}>
            <tr>
              <Header k="name" label="Name" />
              <Header k="role" label="Role" />
              {showSchool && <Header k="schoolName" label="School" />}
              <Header k="lastUsed" label="Last used" help="The most recent day they opened Catalyst" />
              <Header k="daysUsed" label="Days used" help="Days they used Catalyst — not sign-ins. A session lasts a week, so sign-ins would undercount badly." />
              <Header k="observations" label="Observations" help="Published observations, walkthroughs included. Drafts are not counted." />
              <Header k="actionSteps" label="Action steps (incl. extensions)" help="Action steps assigned this year. Extending an existing step counts as one — it is still coaching work." />
            </tr>
          </thead>
          <tbody>
            {visible.map((r: UsageRow, i) => (
              <tr key={r.employeeId} style={{ borderTop: i > 0 ? "1px solid #f1f5f9" : undefined }} className="hover:bg-slate-50">
                <td className="px-3 py-2 font-medium text-slate-800 whitespace-nowrap">{r.name}</td>
                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{r.role.replace(/_/g, " ")}</td>
                {showSchool && <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{r.schoolName ?? "—"}</td>}
                <td className="px-3 py-2 whitespace-nowrap" style={{ color: r.lastUsed ? "#334155" : "#B91C1C" }}>
                  {r.lastUsed
                    ? new Date(r.lastUsed + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                    : "Never"}
                </td>
                <td className="px-3 py-2 tabular-nums text-slate-700">{r.daysUsed}</td>
                <td className="px-3 py-2 tabular-nums text-slate-700">{r.observations}</td>
                <td className="px-3 py-2 tabular-nums text-slate-700">{r.actionSteps}</td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={showSchool ? 7 : 6} className="px-3 py-8 text-center text-sm text-slate-400">
                No one matches those filters.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ height: 4, backgroundColor: YELLOW, borderRadius: 2, opacity: 0 }} />
    </div>
  );
}
