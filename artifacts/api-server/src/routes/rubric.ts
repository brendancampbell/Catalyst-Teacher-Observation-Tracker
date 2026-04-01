import { Router } from "express";
import { db } from "@workspace/db";
import { rubricSets, rubricCategories, rubricDomains } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

/* ── GET /api/rubric/sets ───────────────────────────────────────── */
router.get("/sets", async (_req, res) => {
  try {
    const sets = await db.select().from(rubricSets).orderBy(rubricSets.id);
    res.json(sets);
  } catch (err) {
    console.error("GET /rubric/sets error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── POST /api/rubric/sets ──────────────────────────────────────── */
router.post("/sets", async (req, res) => {
  try {
    const { slug, name, gradeSpan, copyFromSlug } = req.body as {
      slug: string;
      name: string;
      gradeSpan?: string;
      copyFromSlug?: string;
    };
    if (!slug || !name) { res.status(400).json({ error: "slug and name required" }); return; }

    const [rubricSet] = await db
      .insert(rubricSets)
      .values({ slug, name, isActive: false, gradeSpan: gradeSpan || null })
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
router.patch("/sets/:slug", async (req, res) => {
  try {
    const { name, description } = req.body as { name?: string; description?: string };
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name.trim();
    if (description !== undefined) updates.description = description;
    if (Object.keys(updates).length === 0) { res.status(400).json({ error: "Nothing to update" }); return; }

    const [updated] = await db
      .update(rubricSets)
      .set(updates)
      .where(eq(rubricSets.slug, req.params.slug))
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
      where: eq(rubricSets.slug, req.params.setSlug),
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
router.post("/:setSlug/categories", async (req, res) => {
  try {
    const rubricSet = await db.query.rubricSets.findFirst({
      where: eq(rubricSets.slug, req.params.setSlug),
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
router.put("/categories/:id", async (req, res) => {
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
router.delete("/categories/:id", async (req, res) => {
  try {
    await db.delete(rubricCategories).where(eq(rubricCategories.id, Number(req.params.id)));
    res.status(204).send();
  } catch (err) {
    console.error("DELETE /rubric/categories/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── POST /api/rubric/categories/:id/domains ───────────────────── */
router.post("/categories/:id/domains", async (req, res) => {
  try {
    const { name, slug, displayOrder } = req.body;
    if (!name || !slug) { res.status(400).json({ error: "name and slug required" }); return; }
    const [dom] = await db.insert(rubricDomains)
      .values({ categoryId: Number(req.params.id), name, slug, displayOrder: displayOrder ?? 0 })
      .returning();
    res.status(201).json(dom);
  } catch (err) {
    console.error("POST /rubric/categories/:id/domains error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── PUT /api/rubric/domains/:id ────────────────────────────────── */
router.put("/domains/:id", async (req, res) => {
  try {
    const { name, slug, displayOrder } = req.body;
    const [updated] = await db.update(rubricDomains)
      .set({
        ...(name && { name }),
        ...(slug && { slug }),
        ...(displayOrder !== undefined && { displayOrder }),
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
router.delete("/domains/:id", async (req, res) => {
  try {
    await db.delete(rubricDomains).where(eq(rubricDomains.id, Number(req.params.id)));
    res.status(204).send();
  } catch (err) {
    console.error("DELETE /rubric/domains/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
