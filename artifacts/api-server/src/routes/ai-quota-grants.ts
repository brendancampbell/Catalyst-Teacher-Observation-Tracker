import { Router } from "express";
import { db, pool } from "@workspace/db";
import { aiQuotaGrants, people } from "@workspace/db/schema";
import { eq, and, or, desc, gt } from "drizzle-orm";
import { requireNetworkScope } from "../middleware/auth";

const router = Router();

/* All endpoints require network admin scope */
router.use(requireNetworkScope);

/* ── GET /api/ai/quota-grants?employeeId=X ──────────────────────────
   Returns all grants (active and expired) for a given user.          */
router.get("/", async (req, res) => {
  const { employeeId } = req.query as { employeeId?: string };
  if (!employeeId) {
    res.status(400).json({ error: "employeeId query parameter is required." });
    return;
  }

  const grants = await db
    .select({
      id:                  aiQuotaGrants.id,
      employeeId:          aiQuotaGrants.employeeId,
      grantType:           aiQuotaGrants.grantType,
      extraRequests:       aiQuotaGrants.extraRequests,
      usedRequests:        aiQuotaGrants.usedRequests,
      expiresAt:           aiQuotaGrants.expiresAt,
      grantedByEmployeeId: aiQuotaGrants.grantedByEmployeeId,
      note:                aiQuotaGrants.note,
      createdAt:           aiQuotaGrants.createdAt,
    })
    .from(aiQuotaGrants)
    .where(eq(aiQuotaGrants.employeeId, employeeId))
    .orderBy(desc(aiQuotaGrants.createdAt));

  res.json(grants);
});

/* ── POST /api/ai/quota-grants ──────────────────────────────────────
   Creates a new quota grant for a user.                              */
router.post("/", async (req, res) => {
  const actor = req.user as Express.User;
  const {
    employeeId,
    grantType,
    extraRequests,
    expiresInHours,
    note,
  } = req.body as {
    employeeId:     string;
    grantType:      "chat" | "generation" | "all";
    extraRequests:  number;
    expiresInHours: number;
    note?:          string;
  };

  if (!employeeId || !grantType || !extraRequests || !expiresInHours) {
    res.status(400).json({ error: "employeeId, grantType, extraRequests, and expiresInHours are required." });
    return;
  }

  const VALID_TYPES = ["chat", "generation", "all"] as const;
  if (!VALID_TYPES.includes(grantType)) {
    res.status(400).json({ error: `grantType must be one of: ${VALID_TYPES.join(", ")}.` });
    return;
  }

  const extra = Number(extraRequests);
  const hours = Number(expiresInHours);

  if (!Number.isInteger(extra) || extra < 1 || extra > 500) {
    res.status(400).json({ error: "extraRequests must be an integer between 1 and 500." });
    return;
  }

  const MAX_HOURS = 7 * 24;
  if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_HOURS) {
    res.status(400).json({ error: `expiresInHours must be between 1 and ${MAX_HOURS} (7 days).` });
    return;
  }

  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

  const [grant] = await db
    .insert(aiQuotaGrants)
    .values({
      employeeId,
      grantType,
      extraRequests: extra,
      expiresAt,
      grantedByEmployeeId: actor.employeeId,
      note: note?.trim() || null,
    })
    .returning();

  res.status(201).json(grant);
});

/* ── DELETE /api/ai/quota-grants/:id ────────────────────────────────
   Revokes (deletes) a quota grant by id.                             */
router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid grant id." });
    return;
  }

  const deleted = await db
    .delete(aiQuotaGrants)
    .where(eq(aiQuotaGrants.id, id))
    .returning();

  if (deleted.length === 0) {
    res.status(404).json({ error: "Grant not found." });
    return;
  }

  res.json({ ok: true });
});

export default router;
