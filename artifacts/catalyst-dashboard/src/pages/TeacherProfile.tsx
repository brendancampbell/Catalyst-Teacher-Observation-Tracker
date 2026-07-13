import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { CheckCircle2, AlertCircle, ChevronLeft, Loader2 } from "lucide-react";
import { fetchActionSteps, masterActionStep } from "@/lib/api";
import type { ActionStep } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const NAVY = "#1034B4";
const YELLOW = "#FFB500";

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function todayIso(): string {
  return new Date().toISOString().split("T")[0]!;
}

function daysOverdue(dueDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + "T00:00:00");
  return Math.floor((today.getTime() - due.getTime()) / 86_400_000);
}

interface Props {
  employeeId: string;
}

export default function TeacherProfilePage({ employeeId }: Props) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const baseUrl = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

  const {
    data: actionSteps = [],
    isLoading,
    isError,
  } = useQuery<ActionStep[]>({
    queryKey: ["action-steps", employeeId],
    queryFn: () => fetchActionSteps(employeeId),
    staleTime: 30_000,
    enabled: !!employeeId,
  });

  const [masteringId, setMasteringId] = useState<number | null>(null);

  async function handleMaster(id: number) {
    setMasteringId(id);
    try {
      await masterActionStep(id);
      queryClient.invalidateQueries({ queryKey: ["action-steps", employeeId] });
      queryClient.invalidateQueries({ queryKey: ["overdueActionSteps"] });
    } catch {
      /* silent */
    } finally {
      setMasteringId(null);
    }
  }

  const today = todayIso();
  const openSteps = actionSteps.filter((s) => s.status === "open");
  const masteredSteps = actionSteps.filter((s) => s.status === "mastered");

  return (
    <div
      className="h-full overflow-hidden flex flex-col"
      style={{ backgroundColor: "#F4F6FB", fontFamily: "'Libre Franklin', sans-serif" }}
    >
      {/* Simple page header */}
      <header
        className="shrink-0 flex items-center gap-4 px-5 py-3 border-b"
        style={{ backgroundColor: NAVY, borderColor: "#0D2A8C" }}
      >
        <button
          onClick={() => navigate(baseUrl + "/action-center")}
          className="flex items-center gap-1.5 text-sm font-semibold transition-opacity hover:opacity-80"
          style={{ color: "rgba(255,255,255,0.85)" }}
        >
          <ChevronLeft size={16} /> Action Center
        </button>
        <h1
          className="font-bold uppercase tracking-wider text-white text-xl"
          style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.04em" }}
        >
          Action Steps
        </h1>
        <span
          className="ml-1 text-xs font-semibold px-2 py-0.5 rounded"
          style={{ backgroundColor: YELLOW, color: NAVY }}
        >
          {employeeId}
        </span>
      </header>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={32} className="animate-spin" style={{ color: NAVY }} />
          </div>
        ) : isError ? (
          <Card className="border-red-200">
            <CardContent className="flex items-center gap-3 py-6 text-red-700">
              <AlertCircle size={20} />
              <p className="font-semibold">Failed to load action steps. Please refresh.</p>
            </CardContent>
          </Card>
        ) : actionSteps.length === 0 ? (
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="flex flex-col items-center justify-center py-14 gap-3">
              <CheckCircle2 size={48} className="text-green-400" />
              <div className="text-center">
                <p className="font-bold text-lg" style={{ color: NAVY }}>No action steps yet</p>
                <p className="text-slate-500 text-sm mt-1">
                  Action steps assigned during observations will appear here.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {openSteps.length > 0 && (
              <Card className="border-slate-200 shadow-sm">
                <CardHeader className="px-5 pt-5 pb-3">
                  <CardTitle
                    className="text-base font-bold flex items-center gap-2"
                    style={{ color: NAVY }}
                  >
                    <AlertCircle size={16} style={{ color: YELLOW }} />
                    Open Action Steps
                    <span
                      className="text-xs font-bold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: "#FEF3C7", color: "#92400E" }}
                    >
                      {openSteps.length}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-5 space-y-3">
                  {openSteps.map((step) => {
                    const overdue = step.dueDate < today;
                    const days = overdue ? daysOverdue(step.dueDate) : 0;
                    const mastering = masteringId === step.id;
                    return (
                      <div
                        key={step.id}
                        className="rounded-lg border p-4 space-y-2"
                        style={{
                          borderColor: overdue ? "#fca5a5" : "#e2e8f0",
                          backgroundColor: overdue ? "#FFF5F5" : "white",
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-sm font-semibold text-slate-800 flex-1 leading-snug">
                            {step.text}
                          </p>
                          {overdue && (
                            <span
                              className="shrink-0 text-xs font-bold px-2 py-1 rounded-full"
                              style={{ backgroundColor: "#FEE2E2", color: "#B91C1C" }}
                            >
                              Overdue {days}d
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                          <span>
                            Due:{" "}
                            <span className="font-semibold text-slate-700">
                              {formatDate(step.dueDate)}
                            </span>
                          </span>
                          {step.assignedByName && (
                            <span>
                              Assigned by:{" "}
                              <span className="font-semibold text-slate-700">
                                {step.assignedByName}
                              </span>
                            </span>
                          )}
                          <span>
                            Assigned:{" "}
                            <span className="font-semibold text-slate-700">
                              {formatDate(step.createdAt.split("T")[0]!)}
                            </span>
                          </span>
                        </div>
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={() => handleMaster(step.id)}
                            disabled={mastering}
                            className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded transition-opacity hover:opacity-80 disabled:opacity-50"
                            style={{ backgroundColor: "#16a34a", color: "white" }}
                          >
                            {mastering ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <CheckCircle2 size={12} />
                            )}
                            {mastering ? "Marking…" : "Mark Mastered"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            {masteredSteps.length > 0 && (
              <Card className="border-slate-200 shadow-sm">
                <CardHeader className="px-5 pt-5 pb-3">
                  <CardTitle
                    className="text-base font-bold flex items-center gap-2"
                    style={{ color: NAVY }}
                  >
                    <CheckCircle2 size={16} className="text-green-500" />
                    Mastered Action Steps
                    <span
                      className="text-xs font-bold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: "#DCFCE7", color: "#15803D" }}
                    >
                      {masteredSteps.length}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-5 pb-5 space-y-3">
                  {masteredSteps.map((step) => (
                    <div
                      key={step.id}
                      className="rounded-lg border border-green-100 bg-green-50 p-4 space-y-2"
                    >
                      <p className="text-sm font-semibold text-slate-700 leading-snug">
                        {step.text}
                      </p>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                        <span className="font-bold text-green-700">✓ Mastered</span>
                        {step.masteredAt && (
                          <span>
                            on{" "}
                            <span className="font-semibold text-slate-700">
                              {formatDate(step.masteredAt.split("T")[0]!)}
                            </span>
                          </span>
                        )}
                        {step.masteredByName && (
                          <span>
                            by{" "}
                            <span className="font-semibold text-slate-700">
                              {step.masteredByName}
                            </span>
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                        {step.assignedByName && (
                          <span>Assigned by: {step.assignedByName}</span>
                        )}
                        <span>Assigned: {formatDate(step.createdAt.split("T")[0]!)}</span>
                        <span>Due was: {formatDate(step.dueDate)}</span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
