import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, prefabsTable } from "@workspace/db";
import {
  CreatePrefabBody,
  DeletePrefabParams,
  GetPrefabParams,
  ListPrefabsParams,
  UpdatePrefabBody,
  UpdatePrefabParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const formatPrefab = (p: typeof prefabsTable.$inferSelect) => ({
  ...p,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

router.get("/projects/:id/prefabs", async (req, res) => {
  const { id } = ListPrefabsParams.parse(req.params);
  const rows = await db.select().from(prefabsTable).where(eq(prefabsTable.projectId, id));
  res.json(rows.map(formatPrefab));
});

router.post("/prefabs", async (req, res) => {
  const body = CreatePrefabBody.parse(req.body);
  const [row] = await db.insert(prefabsTable).values(body).returning();
  res.status(201).json(formatPrefab(row));
});

router.get("/prefabs/:id", async (req, res) => {
  const { id } = GetPrefabParams.parse(req.params);
  const [row] = await db.select().from(prefabsTable).where(eq(prefabsTable.id, id));
  if (!row) return res.status(404).json({ error: "Prefab not found" });
  res.json(formatPrefab(row));
});

router.put("/prefabs/:id", async (req, res) => {
  const { id } = UpdatePrefabParams.parse(req.params);
  const body = UpdatePrefabBody.parse(req.body);
  const [row] = await db
    .update(prefabsTable)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(prefabsTable.id, id))
    .returning();
  if (!row) return res.status(404).json({ error: "Prefab not found" });
  res.json(formatPrefab(row));
});

router.delete("/prefabs/:id", async (req, res) => {
  const { id } = DeletePrefabParams.parse(req.params);
  await db.delete(prefabsTable).where(eq(prefabsTable.id, id));
  res.status(204).end();
});

export default router;
