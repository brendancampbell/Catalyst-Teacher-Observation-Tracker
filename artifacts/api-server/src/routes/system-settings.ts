import { Router } from "express";
import { db } from "@workspace/db";
import { systemSettings, people } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { requireNetworkAdmin } from "../middleware/auth";
import {
  RESCORE_WINDOW_WEEK_OPTIONS, DAYS_PER_WEEK,
  OVERDUE_WINDOW_MIN_DAYS, OVERDUE_WINDOW_MAX_DAYS,
} from "@workspace/api-types";
import {
  getWindows, invalidateSystemSettingsCache,
  previewRescoreChange, previewOverdueChange, recalculateRescoreDueDates,
} from "../lib/system-settings";

const router = Router();

const ALLOWED_RESCORE_DAYS = RESCORE_WINDOW_WEEK_OPTIONS.map((w) => w * DAYS_PER_WEEK);

/** Name for the audit line, resolved from the stored employee id. */
async function nameOf(employeeId: string | null): Promise<string | null> {
  if (!employeeId) return null;
  const [p] = await db
    .select({ firstName: people.firstName, lastName: people.lastName })
    .from(people).where(eq(people.employeeId, employeeId)).limit(1);
  return p ? `${p.firstName} ${p.lastName}`.trim() : null;
}

async function readSettings() {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.id, 1)).limit(1);
  const windows = await getWindows();
  return {
    rescoreWindowDays: row?.rescoreWindowDays ?? windows.rescoreWindowDays,
    overdueWindowDays: row?.overdueWindowDays ?? windows.overdueWindowDays,
    rescoreUpdatedAt:  row?.rescoreUpdatedAt?.toISOString() ?? null,
    rescoreUpdatedBy:  await nameOf(row?.rescoreUpdatedBy ?? null),
    overdueUpdatedAt:  row?.overdueUpdatedAt?.toISOString() ?? null,
    overdueUpdatedBy:  await nameOf(row?.overdueUpdatedBy ?? null),
  };
}

/* ── GET /api/system-settings ─────────────────────────────────────
   Readable by any signed-in user. The values are not secret — the Action
   Center states them in its own copy, and the AI assistant quotes them — and
   a coach seeing "rescore within 3 weeks" needs the same number the server
   used. Only writing is restricted.                                        */
router.get("/", async (_req, res) => {
  try {
    res.json(await readSettings());
  } catch (err) {
    console.error("GET /system-settings error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── GET /api/system-settings/preview?rescoreWindowDays=&overdueWindowDays=
   What a change would do, before it is made. Network admins only, since it is
   only ever asked on the way to a write.                                   */
router.get("/preview", requireNetworkAdmin, async (req, res) => {
  try {
    const rescoreDays = req.query.rescoreWindowDays !== undefined
      ? Number(req.query.rescoreWindowDays) : null;
    const overdueDays = req.query.overdueWindowDays !== undefined
      ? Number(req.query.overdueWindowDays) : null;

    const rescore = rescoreDays !== null && Number.isFinite(rescoreDays)
      ? await previewRescoreChange(rescoreDays)
      : { affected: 0, newlyOverdue: 0 };

    const overdue = overdueDays !== null && Number.isFinite(overdueDays)
      ? await previewOverdueChange(overdueDays)
      : { newlyListed: 0 };

    res.json({
      rescoreAffected:     rescore.affected,
      rescoreNewlyOverdue: rescore.newlyOverdue,
      overdueNewlyListed:  overdue.newlyListed,
    });
  } catch (err) {
    console.error("GET /system-settings/preview error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── PUT /api/system-settings ─────────────────────────────────────
   Network admins only. Either window may be sent alone.                    */
router.put("/", requireNetworkAdmin, async (req, res) => {
  try {
    const currentUser = req.user as Express.User;
    const { rescoreWindowDays, overdueWindowDays } = req.body as {
      rescoreWindowDays?: unknown; overdueWindowDays?: unknown;
    };

    if (rescoreWindowDays === undefined && overdueWindowDays === undefined) {
      res.status(400).json({ error: "Nothing to update" }); return;
    }

    /* Validated against the same option list the dropdown offers, so a
       hand-made request cannot set a window the interface could not. */
    if (rescoreWindowDays !== undefined) {
      const n = Number(rescoreWindowDays);
      if (!Number.isInteger(n) || !ALLOWED_RESCORE_DAYS.includes(n)) {
        res.status(400).json({
          error: `rescoreWindowDays must be one of ${ALLOWED_RESCORE_DAYS.join(", ")} (1-4 whole weeks)`,
        });
        return;
      }
    }

    if (overdueWindowDays !== undefined) {
      const n = Number(overdueWindowDays);
      if (!Number.isInteger(n) || n < OVERDUE_WINDOW_MIN_DAYS || n > OVERDUE_WINDOW_MAX_DAYS) {
        res.status(400).json({
          error: `overdueWindowDays must be a whole number of days between ${OVERDUE_WINDOW_MIN_DAYS} and ${OVERDUE_WINDOW_MAX_DAYS}`,
        });
        return;
      }
    }

    const before = await getWindows();
    const now = new Date();
    const updates: Record<string, unknown> = { updatedAt: now };

    const rescoreChanged = rescoreWindowDays !== undefined
      && Number(rescoreWindowDays) !== before.rescoreWindowDays;
    const overdueChanged = overdueWindowDays !== undefined
      && Number(overdueWindowDays) !== before.overdueWindowDays;

    if (rescoreChanged) {
      updates.rescoreWindowDays = Number(rescoreWindowDays);
      updates.rescoreUpdatedAt  = now;
      updates.rescoreUpdatedBy  = currentUser.employeeId;
    }
    if (overdueChanged) {
      updates.overdueWindowDays = Number(overdueWindowDays);
      updates.overdueUpdatedAt  = now;
      updates.overdueUpdatedBy  = currentUser.employeeId;
    }

    /* Setting a control to what it already says is not a change: it must not
       stamp somebody's name on a decision they did not make, and must not
       rewrite every deadline for nothing. */
    if (!rescoreChanged && !overdueChanged) {
      res.json({ ...(await readSettings()), recalculated: 0 });
      return;
    }

    let recalculated = 0;

    /* Recalculate BEFORE storing the new window: the recalculation measures
       from the old one to reconstruct each walkthrough date for rows that
       predate rescore_from_date. */
    if (rescoreChanged) {
      recalculated = await recalculateRescoreDueDates(Number(rescoreWindowDays));
    }

    await db.update(systemSettings).set(updates).where(eq(systemSettings.id, 1));
    invalidateSystemSettingsCache();

    res.json({ ...(await readSettings()), recalculated });
  } catch (err) {
    console.error("PUT /system-settings error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
