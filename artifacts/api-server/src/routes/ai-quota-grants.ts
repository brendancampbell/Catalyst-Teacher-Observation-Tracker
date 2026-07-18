import { Router } from "express";
import { db } from "@workspace/db";
import { aiQuotaGrants } from "@workspace/db/schema";
import { eq, and, gt, sql, desc } from "drizzle-orm";
import { requireNetworkScope } from "../middleware/auth";

const router = Router();

/* All endpoints require network admin scope */
router.use(requireNetworkScope);

/* ── GET /api/ai/quota-grants/:employeeId ───────────────────────────
   Returns active grants for the user. Pass ?all=true to include
   expired and exhausted grants as well (for the admin UI history).  */
router.get("/:employeeId", async (req, res) => {
  const { employeeId } = req.params;
  const includeAll = req.query.all === "true";

  const baseQuery = db
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
    .orderBy(desc(aiQuotaGrants.createdAt));

  const grants = includeAll
    ? await baseQuery.where(eq(aiQuotaGrants.employeeId, employeeId))
    : await baseQuery.where(
        and(
          eq(aiQuotaGrants.employeeId, employeeId),
          gt(aiQuotaGrants.expiresAt, new Date()),
          sql`${aiQuotaGrants.usedRequests} < ${aiQuotaGrants.extraRequests}`,
        ),
      );

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

  req.log.info(
    {
      event:               "ai_quota_grant_created",
      grantId:             grant.id,
      employeeId:          grant.employeeId,
      grantType:           grant.grantType,
      extraRequests:       grant.extraRequests,
      expiresAt:           grant.expiresAt,
      actorEmployeeId:     actor.employeeId,
    },
    "AI quota grant created",
  );

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

  const actor = req.user as Express.User;

  const deleted = await db
    .delete(aiQuotaGrants)
    .where(eq(aiQuotaGrants.id, id))
    .returning();

  if (deleted.length === 0) {
    res.status(404).json({ error: "Grant not found." });
    return;
  }

  req.log.info(
    {
      event:           "ai_quota_grant_revoked",
      grantId:         deleted[0].id,
      employeeId:      deleted[0].employeeId,
      grantType:       deleted[0].grantType,
      actorEmployeeId: actor.employeeId,
    },
    "AI quota grant revoked",
  );

  res.json({ ok: true });
});

export default router;
