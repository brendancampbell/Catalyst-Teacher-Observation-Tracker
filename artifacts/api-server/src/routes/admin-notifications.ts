import { Router } from "express";
import { db } from "@workspace/db";
import { platformNotifications } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireNetworkAdmin } from "../middleware/auth";

const router = Router();

router.use(requireNetworkAdmin);

/* GET /api/admin/notifications — list all notifications, newest first */
router.get("/", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(platformNotifications)
      .orderBy(desc(platformNotifications.createdAt));
    res.json(rows);
  } catch (err) {
    console.error("GET /admin/notifications error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* POST /api/admin/notifications — create a notification */
router.post("/", async (req, res) => {
  try {
    const actor = req.user as Express.User;
    const { title, body, displayMode, isActive } = req.body as {
      title:       string;
      body:        string;
      displayMode: "ONCE" | "EVERY_LOGIN";
      isActive?:   boolean;
    };

    if (!title?.trim()) {
      res.status(400).json({ error: "title is required" });
      return;
    }
    if (!body?.trim()) {
      res.status(400).json({ error: "body is required" });
      return;
    }
    if (displayMode !== "ONCE" && displayMode !== "EVERY_LOGIN") {
      res.status(400).json({ error: "displayMode must be ONCE or EVERY_LOGIN" });
      return;
    }

    const [row] = await db
      .insert(platformNotifications)
      .values({
        title:               title.trim(),
        body:                body.trim(),
        displayMode,
        isActive:            isActive === true,
        createdByEmployeeId: actor.employeeId,
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("POST /admin/notifications error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* PATCH /api/admin/notifications/:id — update title/body/displayMode/isActive */
router.patch("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const { title, body, displayMode, isActive } = req.body as {
      title?:       string;
      body?:        string;
      displayMode?: "ONCE" | "EVERY_LOGIN";
      isActive?:    boolean;
    };

    const updates: Partial<typeof platformNotifications.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (title !== undefined) updates.title = title.trim();
    if (body !== undefined) updates.body = body.trim();
    if (displayMode !== undefined) {
      if (displayMode !== "ONCE" && displayMode !== "EVERY_LOGIN") {
        res.status(400).json({ error: "displayMode must be ONCE or EVERY_LOGIN" });
        return;
      }
      updates.displayMode = displayMode;
    }
    if (isActive !== undefined) updates.isActive = isActive;

    const [row] = await db
      .update(platformNotifications)
      .set(updates)
      .where(eq(platformNotifications.id, id))
      .returning();

    if (!row) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    res.json(row);
  } catch (err) {
    console.error("PATCH /admin/notifications/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* DELETE /api/admin/notifications/:id — delete a notification */
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const deleted = await db
      .delete(platformNotifications)
      .where(eq(platformNotifications.id, id))
      .returning();

    if (deleted.length === 0) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /admin/notifications/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
