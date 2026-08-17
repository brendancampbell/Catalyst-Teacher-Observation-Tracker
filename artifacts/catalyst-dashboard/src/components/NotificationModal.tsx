import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/lib/queryKeys";
import {
  fetchActiveNotifications,
  dismissNotification,
  type PlatformNotification,
} from "@/lib/api";
import { useUser } from "@/context/UserContext";
import { } from "lucide-react";

const NAVY   = "#1034B4";
const YELLOW = "#FFB500";

/**
 * NotificationModal — renders active platform notifications as a centered
 * modal overlay, one at a time. Calls /api/notifications/active on mount
 * and queues results. Each notification is dismissed individually before
 * the next one appears.
 */
export default function NotificationModal() {
  const { currentUser, isLoading: userLoading } = useUser();
  const queryClient = useQueryClient();

  const [queue, setQueue]   = useState<PlatformNotification[]>([]);
  const [seeded, setSeeded] = useState(false);

  const { data: notifications = [], isSuccess } = useQuery<PlatformNotification[]>({
    queryKey: QUERY_KEYS.activeNotifications,
    queryFn:  fetchActiveNotifications,
    /* Only fetch once per session — notifications are session-level prompts */
    staleTime: Infinity,
    enabled:  !!currentUser && !userLoading,
  });

  /* Seed the queue once the fetch resolves */
  useEffect(() => {
    if (isSuccess && !seeded) {
      setQueue(notifications);
      setSeeded(true);
    }
  }, [isSuccess, seeded, notifications]);

  const dismissMut = useMutation({
    mutationFn: ({ id, permanent }: { id: number; permanent: boolean }) =>
      dismissNotification(id, permanent),
    onSuccess: () => {
      /* Advance the queue */
      setQueue((prev) => prev.slice(1));
      /* Invalidate so the active list refreshes if the component remounts */
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.activeNotifications });
    },
  });

  const current = queue[0];
  if (!current) return null;

  const isEveryLogin = current.displayMode === "EVERY_LOGIN";

  function handleDismiss(permanent: boolean) {
    if (dismissMut.isPending) return;
    dismissMut.mutate({ id: current.id, permanent });
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
        style={{ border: `3px solid ${NAVY}` }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notif-title"
      >
        {/* Header */}
        <div
          className="px-5 py-4 flex items-center justify-between"
          style={{ backgroundColor: NAVY, borderBottom: `3px solid ${YELLOW}` }}
        >
          <h2
            id="notif-title"
            className="text-white font-bold uppercase tracking-wide leading-tight"
            style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 20, letterSpacing: "0.04em" }}
          >
            {current.title}
          </h2>
          {queue.length > 1 && (
            <span className="text-blue-200 text-xs font-semibold ml-2 shrink-0">
              {queue.length} remaining
            </span>
          )}
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          <p
            className="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap"
            style={{ fontFamily: "'Libre Franklin', sans-serif" }}
          >
            {current.body}
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 flex flex-col gap-2 sm:flex-row sm:justify-end sm:gap-3">
          {isEveryLogin && (
            <button
              onClick={() => handleDismiss(true)}
              disabled={dismissMut.isPending}
              className="order-2 sm:order-1 px-4 py-2 rounded-lg text-sm font-semibold border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              style={{ fontFamily: "'Libre Franklin', sans-serif" }}
            >
              Do not show again
            </button>
          )}
          <button
            onClick={() => handleDismiss(!isEveryLogin /* permanent for ONCE, non-permanent for EVERY_LOGIN */)}
            disabled={dismissMut.isPending}
            className="order-1 sm:order-2 px-6 py-2 rounded-lg font-bold text-sm text-white disabled:opacity-50 hover:opacity-90 transition-opacity"
            style={{
              backgroundColor: NAVY,
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: 15,
              letterSpacing: "0.03em",
            }}
          >
            {dismissMut.isPending ? "…" : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
