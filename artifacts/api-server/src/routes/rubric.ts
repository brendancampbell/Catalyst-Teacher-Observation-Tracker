import { Router } from "express";
import { db } from "@workspace/db";
import {
  rubricSets, rubricCategories, rubricDomains, observationScores,
  insertRubricDomainSchema, patchRubricCategorySchema, patchRubricDomainSchema,
  createRubricCategoryBodySchema, createRubricSetBodySchema, patchRubricSetSchema,
} from "@workspace/db/schema";
import { schoolYears } from "@workspace/db/schema";
import { asc, count, eq, and, ne, max, inArray } from "drizzle-orm";
import { requireNetworkAdmin } from "../middleware/auth";
import { getActiveSchoolYearId } from "../lib/active-school-year";

function firstZodError(err: { issues: { message: string }[] }): string {
  return err.issues[0]?.message ?? "Validation error";
}

const router = Router();

/* ── GET /api/rubric/sets ───────────────────────────────────────── */
router.get("/sets", async (req, res) => {
  try {
    const includeArchived = req.query.includeArchived === "true";

    /* includeArchived=true is admin-only — COACH may not enumerate archived rubric sets. */
    if (includeArchived) {
      const user = req.user as Express.User | undefined;
      const role = user?.role;
      if (role !== "SCHOOL_LEADER" && role !== "NETWORK_LEADER" && role !== "NETWORK_ADMIN") {
        res.status(403).json({ error: "Insufficient permissions" });
        return;
      }
    }

    const activeYearId = await getActiveSchoolYearId();
    if (!activeYearId) {
      res.status(503).json({ error: "No active school year configured." });
      return;
    }

    if (includeArchived) {
      const sets = await db
        .select()
        .from(rubricSets)
        .where(eq(rubricSets.schoolYearId, activeYearId))
        .orderBy(asc(rubricSets.displayOrder), asc(rubricSets.id));
      res.json(sets);
      return;
    }

    const sets = await db
      .select()
      .from(rubricSets)
      .where(and(eq(rubricSets.isArchived, false), eq(rubricSets.schoolYearId, activeYearId)))
      .orderBy(asc(rubricSets.displayOrder), asc(rubricSets.id));
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
    const parsed = createRubricSetBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstZodError(parsed.error) });
      return;
    }
    const { slug, name, gradeSpan, copyFromSlug, target, subjectAudience, schoolYearId } = parsed.data;

    /* Resolve school year — caller may supply one, otherwise use the active year. */
    const resolvedSchoolYearId = schoolYearId ?? await getActiveSchoolYearId();
    if (!resolvedSchoolYearId) {
      res.status(400).json({ error: "No active school year found. Create a school year before adding rubric sets." });
      return;
    }

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
      .values({ slug, name, schoolYearId: resolvedSchoolYearId, isActive: false, gradeSpan: gradeSpan || null, displayOrder: nextOrder, target: target ?? "TEACHER", subjectAudience: subjectAudience ?? "ALL" })
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
            .values({ rubricSetId: rubricSet!.id, name: cat.name, displayOrder: cat.displayOrder })
            .returning();
          if (cat.domains?.length) {
            await db.insert(rubricDomains).values(
              cat.domains.map((d) => ({
                categoryId:   newCat!.id,
                rubricSetId:  rubricSet!.id,
                schoolYearId: resolvedSchoolYearId,
                name:         d.name,
                slug:         d.slug,
                displayOrder: d.displayOrder,
              })),
            );
          }
        }
      }
    }

    res.status(201).json(rubricSet);
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as { code?: unknown }).code === "23505") {
      res.status(409).json({ error: "A rubric with that slug already exists in this school year" }); return;
    }
    console.error("POST /rubric/sets error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── POST /api/rubric/sets/:id/copy-forward ─────────────────────── */
router.post("/sets/:id/copy-forward", requireNetworkAdmin, async (req, res) => {
  try {
    const sourceId = Number(req.params.id);
    if (isNaN(sourceId)) { res.status(400).json({ error: "Invalid rubric set id" }); return; }

    const { targetSchoolYearId } = req.body as { targetSchoolYearId?: number };
    if (!targetSchoolYearId || !Number.isInteger(targetSchoolYearId)) {
      res.status(400).json({ error: "targetSchoolYearId (integer) is required" }); return;
    }

    /* Validate source exists */
    const source = await db.query.rubricSets.findFirst({
      where: eq(rubricSets.id, sourceId),
    });
    if (!source) { res.status(404).json({ error: "Source rubric set not found" }); return; }

    /* Validate target school year exists */
    const [targetYear] = await db.select().from(schoolYears).where(eq(schoolYears.id, targetSchoolYearId)).limit(1);
    if (!targetYear) { res.status(404).json({ error: "Target school year not found" }); return; }

    /* Guard: slug must not already exist in target year */
    const slugConflict = await db.query.rubricSets.findFirst({
      where: and(eq(rubricSets.schoolYearId, targetSchoolYearId), eq(rubricSets.slug, source.slug)),
    });
    if (slugConflict) {
      res.status(409).json({
        error: `A rubric set with slug '${source.slug}' already exists in school year '${targetYear.name}'. Copy would collide.`,
      });
      return;
    }

    /* Load source categories + domains */
    const sourceCats = await db.query.rubricCategories.findMany({
      where: eq(rubricCategories.rubricSetId, source.id),
      orderBy: (c, { asc }) => [asc(c.displayOrder)],
      with: { domains: { orderBy: (d, { asc }) => [asc(d.displayOrder)] } },
    });

    /* Create the copy in a single transaction */
    const newSet = await db.transaction(async (tx) => {
      const [{ maxOrder }] = await tx.select({ maxOrder: max(rubricSets.displayOrder) }).from(rubricSets);
      const nextOrder = (maxOrder ?? 0) + 1;

      const [created] = await tx.insert(rubricSets).values({
        slug:            source.slug,
        name:            source.name,
        schoolYearId:    targetSchoolYearId,
        isActive:        false,
        isArchived:      false,
        gradeSpan:       source.gradeSpan,
        description:     source.description,
        displayOrder:    nextOrder,
        target:          source.target,
        subjectAudience: source.subjectAudience,
      }).returning();

      for (const cat of sourceCats) {
        const [newCat] = await tx.insert(rubricCategories).values({
          rubricSetId:  created!.id,
          name:         cat.name,
          displayOrder: cat.displayOrder,
        }).returning();

        if (cat.domains?.length) {
          await tx.insert(rubricDomains).values(
            cat.domains.map((d) => ({
              categoryId:   newCat!.id,
              rubricSetId:  created!.id,
              schoolYearId: targetSchoolYearId,
              name:         d.name,
              slug:         d.slug,
              displayOrder: d.displayOrder,
              description:  d.description,
            })),
          );
        }
      }

      return created!;
    });

    /* Return the new set with its categories and domains */
    const categories = await db.query.rubricCategories.findMany({
      where: eq(rubricCategories.rubricSetId, newSet.id),
      orderBy: (c, { asc }) => [asc(c.displayOrder)],
      with: { domains: { orderBy: (d, { asc }) => [asc(d.displayOrder)] } },
    });

    res.status(201).json({ rubricSet: newSet, categories });
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as { code?: unknown }).code === "23505") {
      res.status(409).json({ error: "Slug collision in target school year — a domain slug from the source already exists in the target year." }); return;
    }
    console.error("POST /rubric/sets/:id/copy-forward error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── PATCH /api/rubric/sets/:slug ───────────────────────────────── */
router.patch("/sets/:slug", requireNetworkAdmin, async (req, res) => {
  try {
    const parsed = patchRubricSetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstZodError(parsed.error) });
      return;
    }
    const { name, slug: newSlug, description, isArchived, gradeSpan, target, subjectAudience } = parsed.data;
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name.trim();
    if (newSlug !== undefined) updates.slug = newSlug.trim().toUpperCase();
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
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && (err as { code?: unknown }).code === "23505") {
      res.status(409).json({ error: "A rubric with that slug already exists in this school year" }); return;
    }
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

    const parsed = createRubricCategoryBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstZodError(parsed.error) });
      return;
    }
    const { name, displayOrder } = parsed.data;

    const [cat] = await db.insert(rubricCategories)
      .values({ rubricSetId: rubricSet.id, name, displayOrder: displayOrder ?? 0 })
      .returning();
    res.status(201).json(cat);
  } catch (err) {
    console.error("POST /rubric/:setSlug/categories error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── PUT /api/rubric/categories/reorder ─────────────────────────── */
router.put("/categories/reorder", requireNetworkAdmin, async (req, res) => {
  try {
    const items = req.body as { id: number; displayOrder: number }[];
    if (!Array.isArray(items)) { res.status(400).json({ error: "Expected an array" }); return; }
    await Promise.all(
      items.map(({ id, displayOrder }) =>
        db.update(rubricCategories).set({ displayOrder }).where(eq(rubricCategories.id, id))
      )
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("PUT /rubric/categories/reorder error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── PUT /api/rubric/categories/:id ────────────────────────────── */
router.put("/categories/:id", requireNetworkAdmin, async (req, res) => {
  try {
    const parsed = patchRubricCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstZodError(parsed.error) });
      return;
    }
    if (Object.keys(parsed.data).length === 0) {
      res.status(400).json({ error: "Nothing to update" });
      return;
    }
    const [updated] = await db.update(rubricCategories)
      .set(parsed.data)
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
    const catId = Number(req.params.id);
    const force = req.query.force === "true";

    if (!force) {
      const domains = await db.query.rubricDomains.findMany({
        where: eq(rubricDomains.categoryId, catId),
        columns: { slug: true },
      });
      if (domains.length > 0) {
        const slugs = domains.map((d) => d.slug);
        const [{ scoreCount }] = await db
          .select({ scoreCount: count() })
          .from(observationScores)
          .where(inArray(observationScores.domainSlug, slugs));
        if (Number(scoreCount) > 0) {
          res.status(409).json({
            error: `Cannot delete: ${scoreCount} observation score(s) reference this category's domains.`,
            scoreCount: Number(scoreCount),
          });
          return;
        }
      }
    }

    await db.delete(rubricCategories).where(eq(rubricCategories.id, catId));
    res.status(204).send();
  } catch (err) {
    console.error("DELETE /rubric/categories/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── POST /api/rubric/categories/:id/domains ───────────────────── */
router.post("/categories/:id/domains", requireNetworkAdmin, async (req, res) => {
  try {
    const parsed = insertRubricDomainSchema.omit({ categoryId: true, rubricSetId: true, schoolYearId: true }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstZodError(parsed.error) });
      return;
    }

    const categoryId = Number(req.params.id);

    /* Resolve the rubric set this category belongs to */
    const category = await db.query.rubricCategories.findFirst({
      where: eq(rubricCategories.id, categoryId),
    });
    if (!category) { res.status(404).json({ error: "Category not found" }); return; }

    /* Resolve the rubric set to get schoolYearId */
    const rubricSet = await db.query.rubricSets.findFirst({
      where: eq(rubricSets.id, category.rubricSetId),
    });
    if (!rubricSet) { res.status(404).json({ error: "Rubric set not found" }); return; }

    /* Check for a duplicate slug anywhere in the same rubric set */
    const conflict = await db.query.rubricDomains.findFirst({
      where: and(
        eq(rubricDomains.rubricSetId, category.rubricSetId),
        eq(rubricDomains.slug, parsed.data.slug),
      ),
    });
    if (conflict) {
      res.status(409).json({
        error: `A domain with slug '${parsed.data.slug}' already exists in this rubric set.`,
      });
      return;
    }

    const [dom] = await db.insert(rubricDomains)
      .values({ ...parsed.data, categoryId, rubricSetId: category.rubricSetId, schoolYearId: rubricSet.schoolYearId })
      .returning();
    res.status(201).json(dom);
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && (err as { code?: unknown }).code === "23505") {
      res.status(409).json({ error: "A domain with that slug already exists in this rubric set." });
      return;
    }
    console.error("POST /rubric/categories/:id/domains error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── PUT /api/rubric/domains/reorder ────────────────────────────── */
router.put("/domains/reorder", requireNetworkAdmin, async (req, res) => {
  try {
    const items = req.body as { id: number; displayOrder: number }[];
    if (!Array.isArray(items)) { res.status(400).json({ error: "Expected an array" }); return; }
    await Promise.all(
      items.map(({ id, displayOrder }) =>
        db.update(rubricDomains).set({ displayOrder }).where(eq(rubricDomains.id, id))
      )
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("PUT /rubric/domains/reorder error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── PUT /api/rubric/domains/:id ────────────────────────────────── */
router.put("/domains/:id", requireNetworkAdmin, async (req, res) => {
  try {
    const parsed = patchRubricDomainSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstZodError(parsed.error) });
      return;
    }
    if (Object.keys(parsed.data).length === 0) {
      res.status(400).json({ error: "Nothing to update" });
      return;
    }

    /* ── Slug guards ───────────────────────────────────────────────
       1. Slug-rename guard: domainSlug in observation_scores has no
          FK — renaming it would orphan historical scores.
       2. Duplicate-slug guard: two domains in the same rubric set
          must never share a slug or observation scores would match
          both simultaneously, corrupting reporting.              */
    if (parsed.data.slug !== undefined) {
      const domainId = Number(req.params.id);
      const current = await db.query.rubricDomains.findFirst({
        where: eq(rubricDomains.id, domainId),
      });
      if (!current) { res.status(404).json({ error: "Domain not found" }); return; }

      if (parsed.data.slug !== current.slug) {
        const [{ affectedScores }] = await db
          .select({ affectedScores: count() })
          .from(observationScores)
          .where(eq(observationScores.domainSlug, current.slug));

        if (affectedScores > 0) {
          res.status(409).json({
            error: `Cannot rename slug '${current.slug}' — ${affectedScores} observation score row${affectedScores === 1 ? "" : "s"} reference it. Migrate those rows before renaming.`,
          });
          return;
        }

        const conflict = await db.query.rubricDomains.findFirst({
          where: and(
            eq(rubricDomains.rubricSetId, current.rubricSetId),
            eq(rubricDomains.slug, parsed.data.slug),
            ne(rubricDomains.id, domainId),
          ),
        });
        if (conflict) {
          res.status(409).json({
            error: `A domain with slug '${parsed.data.slug}' already exists in this rubric set.`,
          });
          return;
        }
      }
    }

    const [updated] = await db.update(rubricDomains)
      .set(parsed.data)
      .where(eq(rubricDomains.id, Number(req.params.id)))
      .returning();
    if (!updated) { res.status(404).json({ error: "Domain not found" }); return; }
    res.json(updated);
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && (err as { code?: unknown }).code === "23505") {
      res.status(409).json({ error: "A domain with that slug already exists in this rubric set." });
      return;
    }
    console.error("PUT /rubric/domains/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ── DELETE /api/rubric/domains/:id ─────────────────────────────── */
router.delete("/domains/:id", requireNetworkAdmin, async (req, res) => {
  try {
    const domId = Number(req.params.id);
    const force = req.query.force === "true";

    if (!force) {
      const domain = await db.query.rubricDomains.findFirst({
        where: eq(rubricDomains.id, domId),
        columns: { slug: true },
      });
      if (domain) {
        const [{ scoreCount }] = await db
          .select({ scoreCount: count() })
          .from(observationScores)
          .where(eq(observationScores.domainSlug, domain.slug));
        if (Number(scoreCount) > 0) {
          res.status(409).json({
            error: `Cannot delete: ${scoreCount} observation score(s) reference this domain.`,
            scoreCount: Number(scoreCount),
          });
          return;
        }
      }
    }

    await db.delete(rubricDomains).where(eq(rubricDomains.id, domId));
    res.status(204).send();
  } catch (err) {
    console.error("DELETE /rubric/domains/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
