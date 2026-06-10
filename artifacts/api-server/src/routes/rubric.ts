import { Router } from "express";
import { db } from "@workspace/db";
import { rubricSets, rubricCategories, rubricDomains } from "@workspace/db/schema";
import { asc, count, eq, max } from "drizzle-orm";
import { requireNetworkAdmin } from "../middleware/auth";

const router = Router();

/* ── GET /api/rubric/sets ───────────────────────────────────────── */
router.get("/sets", async (req, res) => {
  try {
    const includeArchived = req.query.includeArchived === "true";
    const query = db.select().from(rubricSets).orderBy(asc(rubricSets.displayOrder), asc(rubricSets.id));
    const sets = includeArchived
      ? await query
      : await db.select().from(rubricSets).where(eq(rubricSets.isArchived, false)).orderBy(asc(rubricSets.displayOrder), asc(rubricSets.id));
    res.json(sets);
  } catch (err) {
    console.error("GET /rubric/sets error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── PUT /api/rubric/sets/reorder ───────────────────────────────── */
router.put("/sets/reorder", requireNetworkAdmin, async (req, res) => {
  try {
    const items = req.body as { slug: string; displayOrder: number }[];
    if (!Array.isArray(items)) { res.status(400).json({ error: "Expected an array" }); return; }
    await Promise.all(
      items.map(({ slug, displayOrder }) =>
        db.update(rubricSets).set({ displayOrder }).where(eq(rubricSets.slug, slug))
      )
    );
    const sets = await db.select().from(rubricSets)
      .orderBy(asc(rubricSets.displayOrder), asc(rubricSets.id));
    res.json(sets);
  } catch (err) {
    console.error("PUT /rubric/sets/reorder error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── POST /api/rubric/sets ──────────────────────────────────────── */
router.post("/sets", requireNetworkAdmin, async (req, res) => {
  try {
    const { slug, name, gradeSpan, copyFromSlug, target, subjectAudience } = req.body as {
      slug: string;
      name: string;
      gradeSpan?: string;
      copyFromSlug?: string;
      target?: "TEACHER" | "SCHOOL";
      subjectAudience?: "STEM" | "HUMANITIES" | "ALL";
    };
    if (!slug || !name) { res.status(400).json({ error: "slug and name required" }); return; }

    const MAX_ACTIVE_SETS = 6;
    const [{ activeCount }] = await db.select({ activeCount: count() }).from(rubricSets).where(eq(rubricSets.isArchived, false));
    if (activeCount >= MAX_ACTIVE_SETS) {
      res.status(400).json({ error: `Maximum of ${MAX_ACTIVE_SETS} active rubric sets reached. Archive a set before creating a new one.` });
      return;
    }

    const [{ maxOrder }] = await db.select({ maxOrder: max(rubricSets.displayOrder) }).from(rubricSets);
    const nextOrder = (maxOrder ?? 0) + 1;

    const [rubricSet] = await db
      .insert(rubricSets)
      .values({ slug, name, isActive: false, gradeSpan: gradeSpan || null, displayOrder: nextOrder, target: target ?? "TEACHER", subjectAudience: subjectAudience ?? "ALL" })
      .returning();

    /* Optional: copy categories + domains from an existing rubric set */
    if (copyFromSlug) {
      const source = await db.query.rubricSets.findFirst({
        where: eq(rubricSets.slug, copyFromSlug),
      });
      if (source) {
        const sourceCats = await db.query.rubricCategories.findMany({
          where: eq(rubricCategories.rubricSetId, source.id),
          orderBy: (c, { asc }) => [asc(c.displayOrder)],
          with: { domains: { orderBy: (d, { asc }) => [asc(d.displayOrder)] } },
        });
        for (const cat of sourceCats) {
          const [newCat] = await db.insert(rubricCategories)
            .values({ rubricSetId: rubricSet.id, name: cat.name, displayOrder: cat.displayOrder })
            .returning();
          if (cat.domains?.length) {
            await db.insert(rubricDomains).values(
              cat.domains.map((d) => ({
                categoryId: newCat.id,
                name: d.name,
                slug: d.slug,
                displayOrder: d.displayOrder,
              })),
            );
          }
        }
      }
    }

    res.status(201).json(rubricSet);
  } catch (err) {
    console.error("POST /rubric/sets error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── PATCH /api/rubric/sets/:slug ───────────────────────────────── */
router.patch("/sets/:slug", requireNetworkAdmin, async (req, res) => {
  try {
    const { name, description, isArchived, gradeSpan, target, subjectAudience } = req.body as { name?: string; description?: string; isArchived?: boolean; gradeSpan?: string | null; target?: "TEACHER" | "SCHOOL"; subjectAudience?: "STEM" | "HUMANITIES" | "ALL" };
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name.trim();
    if (description !== undefined) updates.description = description;
    if (isArchived !== undefined) updates.isArchived = isArchived;
    if (gradeSpan !== undefined) updates.gradeSpan = gradeSpan;
    if (target !== undefined) updates.target = target;
    if (subjectAudience !== undefined) updates.subjectAudience = subjectAudience;
    if (Object.keys(updates).length === 0) { res.status(400).json({ error: "Nothing to update" }); return; }

    const [updated] = await db
      .update(rubricSets)
      .set(updates)
      .where(eq(rubricSets.slug, req.params.slug as string))
      .returning();

    if (!updated) { res.status(404).json({ error: "Rubric set not found" }); return; }
    res.json(updated);
  } catch (err) {
    console.error("PATCH /rubric/sets/:slug error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── GET /api/rubric/:setSlug ───────────────────────────────────── */
router.get("/:setSlug", async (req, res) => {
  try {
    const rubricSet = await db.query.rubricSets.findFirst({
      where: eq(rubricSets.slug, req.params.setSlug as string),
    });
    if (!rubricSet) { res.status(404).json({ error: "Rubric set not found" }); return; }

    const categories = await db.query.rubricCategories.findMany({
      where: eq(rubricCategories.rubricSetId, rubricSet.id),
      orderBy: (c, { asc }) => [asc(c.displayOrder)],
      with: { domains: { orderBy: (d, { asc }) => [asc(d.displayOrder)] } },
    });

    res.json({ rubricSet, categories });
  } catch (err) {
    console.error("GET /rubric/:setSlug error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── POST /api/rubric/:setSlug/categories ───────────────────────── */
router.post("/:setSlug/categories", requireNetworkAdmin, async (req, res) => {
  try {
    const rubricSet = await db.query.rubricSets.findFirst({
      where: eq(rubricSets.slug, req.params.setSlug as string),
    });
    if (!rubricSet) { res.status(404).json({ error: "Rubric set not found" }); return; }

    const { name, displayOrder } = req.body;
    if (!name) { res.status(400).json({ error: "name required" }); return; }

    const [cat] = await db.insert(rubricCategories)
      .values({ rubricSetId: rubricSet.id, name, displayOrder: displayOrder ?? 0 })
      .returning();
    res.status(201).json(cat);
  } catch (err) {
    console.error("POST /rubric/:setSlug/categories error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── PUT /api/rubric/categories/:id ────────────────────────────── */
router.put("/categories/:id", requireNetworkAdmin, async (req, res) => {
  try {
    const { name, displayOrder } = req.body;
    const [updated] = await db.update(rubricCategories)
      .set({ ...(name && { name }), ...(displayOrder !== undefined && { displayOrder }) })
      .where(eq(rubricCategories.id, Number(req.params.id)))
      .returning();
    if (!updated) { res.status(404).json({ error: "Category not found" }); return; }
    res.json(updated);
  } catch (err) {
    console.error("PUT /rubric/categories/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── DELETE /api/rubric/categories/:id ─────────────────────────── */
router.delete("/categories/:id", requireNetworkAdmin, async (req, res) => {
  try {
    await db.delete(rubricCategories).where(eq(rubricCategories.id, Number(req.params.id)));
    res.status(204).send();
  } catch (err) {
    console.error("DELETE /rubric/categories/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── POST /api/rubric/categories/:id/domains ───────────────────── */
router.post("/categories/:id/domains", requireNetworkAdmin, async (req, res) => {
  try {
    const { name, slug, displayOrder, description } = req.body;
    if (!name || !slug) { res.status(400).json({ error: "name and slug required" }); return; }
    const [dom] = await db.insert(rubricDomains)
      .values({ categoryId: Number(req.params.id), name, slug, displayOrder: displayOrder ?? 0, ...(description ? { description } : {}) })
      .returning();
    res.status(201).json(dom);
  } catch (err) {
    console.error("POST /rubric/categories/:id/domains error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── PUT /api/rubric/domains/:id ────────────────────────────────── */
router.put("/domains/:id", requireNetworkAdmin, async (req, res) => {
  try {
    const { name, slug, displayOrder, description } = req.body;
    const [updated] = await db.update(rubricDomains)
      .set({
        ...(name && { name }),
        ...(slug && { slug }),
        ...(displayOrder !== undefined && { displayOrder }),
        ...(description !== undefined && { description }),
      })
      .where(eq(rubricDomains.id, Number(req.params.id)))
      .returning();
    if (!updated) { res.status(404).json({ error: "Domain not found" }); return; }
    res.json(updated);
  } catch (err) {
    console.error("PUT /rubric/domains/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── DELETE /api/rubric/domains/:id ─────────────────────────────── */
router.delete("/domains/:id", requireNetworkAdmin, async (req, res) => {
  try {
    await db.delete(rubricDomains).where(eq(rubricDomains.id, Number(req.params.id)));
    res.status(204).send();
  } catch (err) {
    console.error("DELETE /rubric/domains/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
