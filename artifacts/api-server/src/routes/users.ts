import { Router } from "express";
import { db } from "@workspace/db";
import { users } from "@workspace/db/schema";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const rows = await db.select().from(users).orderBy(users.id);
    res.json(rows);
  } catch (err) {
    console.error("GET /users error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
