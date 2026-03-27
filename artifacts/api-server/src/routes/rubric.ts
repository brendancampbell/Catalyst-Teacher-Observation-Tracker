import { Router } from "express";
import { db } from "@workspace/db";
import { rubricQuarters, rubricCategories, rubricDomains } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

/* ── GET /api/rubric/quarters ───────────────────────────────────── */
router.get("/quarters", async (_req, res) => {
  try {
    const quarters = await db.select().from(rubricQuarters).orderBy(rubricQuarters.id);
    res.json(quarters);
  } catch (err) {
    console.error("GET /rubric/quarters error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── POST /api/rubric/quarters ──────────────────────────────────── */
router.post("/quarters", async (req, res) => {
  try {
    const { slug, name, copyFromSlug } = req.body as {
      slug: string;
      name: string;
      copyFromSlug?: string;
    };
    if (!slug || !name) { res.status(400).json({ error: "slug and name required" }); return; }

    const [quarter] = await db.insert(rubricQuarters).values({ slug, name, isActive: false }).returning();

    /* Optional: copy categories + domains from an existing quarter */
    if (copyFromSlug) {
      const source = await db.query.rubricQuarters.findFirst({
        where: eq(rubricQuarters.slug, copyFromSlug),
      });
      if (source) {
        const sourceCats = await db.query.rubricCategories.findMany({
          where: eq(rubricCategories.quarterId, source.id),
          orderBy: (c, { asc }) => [asc(c.displayOrder)],
          with: { domains: { orderBy: (d, { asc }) => [asc(d.displayOrder)] } },
        });
        for (const cat of sourceCats) {
          const [newCat] = await db.insert(rubricCategories)
            .values({ quarterId: quarter.id, name: cat.name, displayOrder: cat.displayOrder })
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

    res.status(201).json(quarter);
  } catch (err) {
    console.error("POST /rubric/quarters error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── GET /api/rubric/:quarterSlug ───────────────────────────────── */
router.get("/:quarterSlug", async (req, res) => {
  try {
    const quarter = await db.query.rubricQuarters.findFirst({
      where: eq(rubricQuarters.slug, req.params.quarterSlug),
    });
    if (!quarter) { res.status(404).json({ error: "Quarter not found" }); return; }

    const categories = await db.query.rubricCategories.findMany({
      where: eq(rubricCategories.quarterId, quarter.id),
      orderBy: (c, { asc }) => [asc(c.displayOrder)],
      with: { domains: { orderBy: (d, { asc }) => [asc(d.displayOrder)] } },
    });

    res.json({ quarter, categories });
  } catch (err) {
    console.error("GET /rubric/:quarterSlug error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── POST /api/rubric/:quarterSlug/categories ───────────────────── */
router.post("/:quarterSlug/categories", async (req, res) => {
  try {
    const quarter = await db.query.rubricQuarters.findFirst({
      where: eq(rubricQuarters.slug, req.params.quarterSlug),
    });
    if (!quarter) { res.status(404).json({ error: "Quarter not found" }); return; }

    const { name, displayOrder } = req.body;
    if (!name) { res.status(400).json({ error: "name required" }); return; }

    const [cat] = await db.insert(rubricCategories)
      .values({ quarterId: quarter.id, name, displayOrder: displayOrder ?? 0 })
      .returning();
    res.status(201).json(cat);
  } catch (err) {
    console.error("POST /rubric/:quarterSlug/categories error:", err);
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
