import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { School, ChevronDown, LayoutDashboard, FileX, Loader2 } from "lucide-react";
import AppHeader from "@/components/AppHeader";
import { ObservationCard } from "@/components/ObservationCard";
import { ObservationDetailModal } from "@/components/ObservationDetailModal";
import { useUser } from "@/context/UserContext";
import { QUERY_KEYS } from "@/lib/queryKeys";
import { fetchSchoolObservations, updateObservation, deleteObservation } from "@/lib/api";
import { canEditObservation } from "@/lib/observation-permissions";
import type { Observation, RubricSetRow, Score } from "@/lib/api";

const NAVY   = "#1034B4";
const YELLOW = "#FFB500";

interface Props {
  schoolId:         number;
  /** The school-wide rubric clicked through from. */
  initialRubricSet: string;
  /** Every school-wide rubric, for the switcher. */
  rubricSets:       RubricSetRow[];
  onBack:           () => void;
  /** Takes the reader to this school's dashboard for classroom observations. */
  onOpenSchoolDashboard: () => void;
}

/**
 * One school's school-wide observation history.
 *
 * The teacher profile's counterpart, and deliberately the same shape: the same
 * cards, the same pop-up, the same corrections. A school-wide observation is an
 * observation — it just happens to be about a building rather than a person.
 *
 * Three things are absent, each because of what the observation is rather than
 * to keep this page simple. There is no action-steps drawer, because the server
 * only allows action steps on teacher observations. There is no email, because
 * there is no teacher to write to. And there is no rescore banner, because the
 * rescore queue is a fact about teachers.
 */
export function SchoolProfileOverlay({
  schoolId, initialRubricSet, rubricSets, onBack, onOpenSchoolDashboard,
}: Props) {
  const { currentUser } = useUser();
  const queryClient     = useQueryClient();
  const basePath        = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

  const [selectedSlug, setSelectedSlug] = useState(initialRubricSet);
  const [rubricMenuOpen, setRubricMenuOpen] = useState(false);
  const [selected, setSelected] = useState<Observation | null>(null);

  /* Only school-wide rubrics belong in the switcher. A classroom rubric has no
     school-wide history, and the endpoint refuses one outright. */
  const schoolWideSets = useMemo(
    () => rubricSets.filter((r) => r.target === "SCHOOL"),
    [rubricSets],
  );

  const { data, isLoading, isError } = useQuery({
    queryKey: [...QUERY_KEYS.schoolObservations, schoolId, selectedSlug],
    queryFn:  () => fetchSchoolObservations(schoolId, selectedSlug),
    staleTime: 30_000,
  });

  const observations = data?.observations ?? [];
  const categories   = data?.categories   ?? [];
  const school       = data?.school;
  const activeRubricName =
    schoolWideSets.find((r) => r.slug === selectedSlug)?.name ?? selectedSlug;

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.schoolObservations });
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.districtSummary });
    await queryClient.invalidateQueries({ queryKey: QUERY_KEYS.district });
  }

  return (
    <div className="h-full overflow-y-auto flex flex-col" style={{ backgroundColor: "#F4F6FB", fontFamily: "'Libre Franklin', sans-serif" }}>

      <div className="sticky top-0 z-30 shadow-md">
        {currentUser && (
          <AppHeader
            subtitle={school?.name ?? "School"}
            backHref="#"
            backLabel="Network"
            basePath={basePath}
            userName={currentUser.name}
            userEmail={currentUser.email}
            userRole={currentUser.role}
            canAdmin={currentUser.role !== "COACH"}
          />
        )}
      </div>

      <main className="px-3 sm:px-5 py-3 sm:py-5 flex flex-col gap-4 sm:gap-5 flex-1">

        {/* ── School hero ─────────────────────────────────── */}
        <div className="rounded-xl bg-white border border-slate-200 shadow-sm px-5 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded flex items-center justify-center shrink-0" style={{ backgroundColor: NAVY }}>
              <School size={22} color={YELLOW} />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl uppercase leading-none truncate"
                  style={{ fontFamily: "'Bebas Neue', sans-serif", color: NAVY, letterSpacing: "0.03em" }}>
                {school?.name ?? "…"}
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {[school?.abbreviation, school?.gradeSpan, school?.region].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Rubric switcher, as on a teacher's page */}
            {schoolWideSets.length > 1 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setRubricMenuOpen((v) => !v)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded text-sm font-semibold border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  {activeRubricName}
                  <ChevronDown size={14} />
                </button>
                {rubricMenuOpen && (
                  <div className="absolute right-0 mt-1 z-20 bg-white border border-slate-200 rounded shadow-lg py-1 min-w-[220px]">
                    {schoolWideSets.map((rs) => (
                      <button
                        key={rs.slug}
                        type="button"
                        onClick={() => { setSelectedSlug(rs.slug); setRubricMenuOpen(false); }}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-blue-50 transition-colors"
                        style={{ color: rs.slug === selectedSlug ? NAVY : "#475569", fontWeight: rs.slug === selectedSlug ? 700 : 500 }}
                      >
                        {rs.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* The way across to classroom observations for this school. */}
            <button
              type="button"
              onClick={onOpenSchoolDashboard}
              className="flex items-center gap-1.5 px-4 py-2 rounded text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm"
              style={{ backgroundColor: NAVY }}
            >
              <LayoutDashboard size={14} />
              School Dashboard
            </button>
          </div>
        </div>

        {/* ── History ─────────────────────────────────────── */}
        {isLoading && (
          <div className="flex items-center justify-center py-20 gap-2 text-slate-400">
            <Loader2 size={20} className="animate-spin" /> Loading observations…
          </div>
        )}

        {isError && (
          <div className="text-center py-20 text-red-600 text-sm font-semibold">
            Could not load this school&rsquo;s observations.
          </div>
        )}

        {!isLoading && !isError && observations.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            <FileX size={44} className="text-slate-300" />
            <p className="text-lg font-semibold text-slate-400">No school-wide observations yet</p>
            <p className="text-sm text-slate-400 max-w-sm">
              Nothing has been recorded for {school?.name ?? "this school"} on {activeRubricName}.
            </p>
          </div>
        )}

        {!isLoading && !isError && observations.length > 0 && (
          <div className="flex flex-col gap-4">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
              {observations.length} observation{observations.length !== 1 ? "s" : ""} · {activeRubricName}
            </p>
            {observations.map((obs, i) => (
              <ObservationCard
                key={obs.id}
                obs={obs}
                index={i}
                categories={categories}
                onClick={() => setSelected(obs)}
              />
            ))}
          </div>
        )}
      </main>

      {selected && school && (
        <ObservationDetailModal
          /* The school stands where the teacher does. It is what the
             observation is about, and the pop-up asks for a name and a
             grade span, which a school has. */
          teacher={{ name: school.name, subject: school.abbreviation, gradeLevel: school.gradeSpan ? [school.gradeSpan] : [] }}
          observation={selected}
          categories={categories}
          schoolWide
          canEdit={canEditObservation(selected, currentUser)}
          open={!!selected}
          onOpenChange={(o) => { if (!o) setSelected(null); }}
          priorObservations={observations}
          onSave={async (updated) => {
            const saved = await updateObservation(updated.id, {
              strengths:     updated.strengths,
              growthAreas:   updated.growthAreas,
              scores:        updated.scores as Record<string, Score>,
              date:          updated.date,
              time:          updated.time ?? null,
              isWalkthrough: updated.isWalkthrough,
            });
            setSelected(saved);
            await refresh();
          }}
          onDelete={canEditObservation(selected, currentUser) ? async (observationId) => {
            await deleteObservation(observationId, true);
            setSelected(null);
            await refresh();
          } : undefined}
        />
      )}
    </div>
  );
}
