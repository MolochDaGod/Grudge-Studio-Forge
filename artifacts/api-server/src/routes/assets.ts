import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, assetsTable } from "@workspace/db";
import {
  CreateAssetBody,
  DeleteAssetParams,
  ListAssetsParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const formatAsset = (a: typeof assetsTable.$inferSelect) => ({
  ...a,
  createdAt: a.createdAt.toISOString(),
});

router.get("/projects/:id/assets", async (req, res) => {
  const { id } = ListAssetsParams.parse(req.params);
  const assets = await db.select().from(assetsTable).where(eq(assetsTable.projectId, id));
  res.json(assets.map(formatAsset));
});

router.post("/assets", async (req, res) => {
  const body = CreateAssetBody.parse(req.body);
  const [asset] = await db.insert(assetsTable).values(body).returning();
  res.status(201).json(formatAsset(asset));
});

router.delete("/assets/:id", async (req, res) => {
  const { id } = DeleteAssetParams.parse(req.params);
  await db.delete(assetsTable).where(eq(assetsTable.id, id));
  res.status(204).end();
});

export default router;
