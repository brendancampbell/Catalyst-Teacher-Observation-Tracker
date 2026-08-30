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

  /* Same header as every other table in the tool — navy ground, Bebas Neue,
     3px yellow rule. This one also sorts, which the others do not, so the
     active column is picked out in yellow rather than by a colour change that
     would be invisible against the navy. */
  const Header = ({ k, label, help }: { k: SortKey; label: string; help?: string }) => (
    <th
      className="px-4 py-3 text-left font-bold uppercase tracking-wider text-base cursor-pointer select-none whitespace-nowrap transition-colors hover:brightness-110"
      style={{
        fontFamily:    "'Bebas Neue', sans-serif",
        letterSpacing: "0.04em",
        color:         sortKey === k ? YELLOW : "white",
      }}
      onClick={() => toggleSort(k)}
      title={help}
      aria-sort={sortKey === k ? (ascending ? "ascending" : "descending") : "none"}
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
          This tab covers the current school year, not only the currently selected rubric.
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
      <div className="bg-white rounded-xl shadow-sm overflow-hidden" style={{ border: "1px solid #dde3f0" }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: NAVY }}>
                <Header k="name" label="Name" />
                <Header k="role" label="Role" />
                {showSchool && <Header k="schoolName" label="School" />}
                <Header k="lastUsed" label="Last used" help="The most recent day they opened Catalyst" />
                <Header k="daysUsed" label="Total Days Used" />
                <Header k="observations" label="Observations" help="Published observations, walkthroughs included. Drafts are not counted." />
                <Header k="actionSteps" label="Action steps (incl. extensions)" help="Action steps assigned this year. Extending an existing step counts as one — it is still coaching work." />
              </tr>
              <tr style={{ height: 3, backgroundColor: YELLOW }}>
                <td colSpan={showSchool ? 7 : 6} style={{ padding: 0, height: 3 }} />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((r: UsageRow) => (
                <tr key={r.employeeId} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-semibold whitespace-nowrap" style={{ color: NAVY }}>{r.name}</td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{r.role.replace(/_/g, " ")}</td>
                  {showSchool && <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{r.schoolName ?? "—"}</td>}
                  <td className="px-4 py-3 whitespace-nowrap font-semibold" style={{ color: r.lastUsed ? "#475569" : "#B91C1C" }}>
                    {r.lastUsed
                      ? new Date(r.lastUsed + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                      : "Never"}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{r.daysUsed}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{r.observations}</td>
                  <td className="px-4 py-3 tabular-nums text-slate-600">{r.actionSteps}</td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={showSchool ? 7 : 6} className="px-4 py-8 text-center text-sm text-slate-400">
                  No one matches those filters.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ height: 4, backgroundColor: YELLOW, borderRadius: 2, opacity: 0 }} />
    </div>
  );
}
