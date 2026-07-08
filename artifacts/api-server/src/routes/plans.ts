import { Router } from "express";
import { db, plansTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreatePlanBody,
  UpdatePlanBody,
  GetPlanParams,
  UpdatePlanParams,
  DeletePlanParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const plans = await db.select().from(plansTable).orderBy(plansTable.priceMonthly);
    return res.json(plans);
  } catch (err) {
    req.log.error(err, "Failed to list plans");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", async (req, res) => {
  const parsed = CreatePlanBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });

  try {
    const [plan] = await db.insert(plansTable).values({
      name: parsed.data.name,
      description: parsed.data.description,
      priceMonthly: parsed.data.priceMonthly,
      features: parsed.data.features ?? [],
      tier: parsed.data.tier,
      maxEas: parsed.data.maxEas,
      maxSymbols: parsed.data.maxSymbols,
      autonomousAllowed: parsed.data.autonomousAllowed ?? false,
      apiAccessAllowed: parsed.data.apiAccessAllowed ?? true,
      researchAccess: parsed.data.researchAccess ?? true,
      isActive: parsed.data.isActive ?? true,
    }).returning();
    return res.status(201).json(plan);
  } catch (err) {
    req.log.error(err, "Failed to create plan");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", async (req, res) => {
  const parsed = GetPlanParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  try {
    const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, parsed.data.id));
    if (!plan) return res.status(404).json({ error: "Not found" });
    return res.json(plan);
  } catch (err) {
    req.log.error(err, "Failed to get plan");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/:id", async (req, res) => {
  const params = UpdatePlanParams.safeParse({ id: Number(req.params.id) });
  const body = UpdatePlanBody.safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Invalid request" });

  try {
    const [plan] = await db.update(plansTable)
      .set({ ...body.data })
      .where(eq(plansTable.id, params.data.id))
      .returning();
    if (!plan) return res.status(404).json({ error: "Not found" });
    return res.json(plan);
  } catch (err) {
    req.log.error(err, "Failed to update plan");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", async (req, res) => {
  const parsed = DeletePlanParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) return res.status(400).json({ error: "Invalid id" });

  try {
    await db.delete(plansTable).where(eq(plansTable.id, parsed.data.id));
    return res.status(204).send();
  } catch (err) {
    req.log.error(err, "Failed to delete plan");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
