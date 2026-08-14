import { Router } from "express";
import { db } from "@workspace/db";
import { platformNotifications, notificationDismissals } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";

const router = Router();

/* GET /api/notifications/active
   Returns active notifications not permanently dismissed by the current user.
   - ONCE mode:        suppressed if ANY dismissal row exists for this user
   - EVERY_LOGIN mode: suppressed only if a dismissal row with is_permanent=true exists */
router.get("/active", async (req, res) => {
  try {
    const user = req.user as Express.User;

    /* Fetch all active notifications */
    const allActive = await db
      .select()
      .from(platformNotifications)
      .where(eq(platformNotifications.isActive, true))
      .orderBy(platformNotifications.createdAt);

    if (allActive.length === 0) {
      res.json([]);
      return;
    }

    /* Fetch all dismissals for the current user */
    const dismissals = await db
      .select()
      .from(notificationDismissals)
      .where(eq(notificationDismissals.employeeId, user.employeeId));

    const dismissalMap = new Map(
      dismissals.map((d) => [d.notificationId, d]),
    );

    const visible = allActive.filter((n) => {
      const dismissal = dismissalMap.get(n.id);
      if (!dismissal) return true;                  // never dismissed → show
      if (n.displayMode === "ONCE") return false;   // any dismissal → hide
      return !dismissal.isPermanent;                // EVERY_LOGIN: hide only if permanently dismissed
    });

    res.json(visible);
  } catch (err) {
    console.error("GET /notifications/active error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* POST /api/notifications/:id/dismiss
   Body: { permanent: boolean }
   - ONCE mode always writes permanent=true regardless of the request body.
   - EVERY_LOGIN mode respects the permanent flag.
   Upserts the dismissal row (unique on notification_id + employee_id). */
router.post("/:id/dismiss", async (req, res) => {
  try {
    const user = req.user as Express.User;
    const notificationId = Number(req.params.id);
    if (!Number.isInteger(notificationId) || notificationId < 1) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const { permanent } = req.body as { permanent?: boolean };

    /* Fetch the notification to determine its mode */
    const [notification] = await db
      .select()
      .from(platformNotifications)
      .where(eq(platformNotifications.id, notificationId))
      .limit(1);

    if (!notification) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }

    /* ONCE mode always writes permanent=true */
    const isPermanent = notification.displayMode === "ONCE" ? true : (permanent === true);

    /* Check if dismissal already exists */
    const [existing] = await db
      .select()
      .from(notificationDismissals)
      .where(
        and(
          eq(notificationDismissals.notificationId, notificationId),
          eq(notificationDismissals.employeeId, user.employeeId),
        ),
      )
      .limit(1);

    if (existing) {
      /* If upgrading from non-permanent to permanent, update */
      if (isPermanent && !existing.isPermanent) {
        await db
          .update(notificationDismissals)
          .set({ isPermanent: true, dismissedAt: new Date() })
          .where(eq(notificationDismissals.id, existing.id));
      }
    } else {
      await db
        .insert(notificationDismissals)
        .values({
          notificationId,
          employeeId: user.employeeId,
          isPermanent,
        });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /notifications/:id/dismiss error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
