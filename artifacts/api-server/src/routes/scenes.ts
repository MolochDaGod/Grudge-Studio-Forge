import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, scenesTable, projectsTable } from "@workspace/db";
import {
  CreateSceneBody,
  UpdateSceneBody,
  GetSceneParams,
  UpdateSceneParams,
  DeleteSceneParams,
  ListScenesParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const DEFAULT_SCENE_DATA = {
  entities: [],
  environment: {
    skyColor: "#0a0a14",
    groundColor: "#1a1a2e",
    ambientIntensity: 0.4,
    sunIntensity: 1.2,
    gravity: [0, -9.81, 0],
  },
};

const formatScene = (scene: typeof scenesTable.$inferSelect) => ({
  ...scene,
  createdAt: scene.createdAt.toISOString(),
  updatedAt: scene.updatedAt.toISOString(),
});

router.get("/projects/:id/scenes", async (req, res) => {
  const { id } = ListScenesParams.parse(req.params);
  const scenes = await db.select().from(scenesTable).where(eq(scenesTable.projectId, id));
  res.json(scenes.map(formatScene));
});

router.post("/scenes", async (req, res) => {
  const body = CreateSceneBody.parse(req.body);
  const [scene] = await db
    .insert(scenesTable)
    .values({
      projectId: body.projectId,
      name: body.name,
      data: body.data ?? DEFAULT_SCENE_DATA,
    })
    .returning();
  await db
    .update(projectsTable)
    .set({ updatedAt: new Date() })
    .where(eq(projectsTable.id, body.projectId));
  res.status(201).json(formatScene(scene));
});

router.get("/scenes/:id", async (req, res) => {
  const { id } = GetSceneParams.parse(req.params);
  const [scene] = await db.select().from(scenesTable).where(eq(scenesTable.id, id));
  if (!scene) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(formatScene(scene));
});

router.patch("/scenes/:id", async (req, res) => {
  const { id } = UpdateSceneParams.parse(req.params);
  const body = UpdateSceneBody.parse(req.body);
  const [scene] = await db
    .update(scenesTable)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(scenesTable.id, id))
    .returning();
  if (!scene) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await db
    .update(projectsTable)
    .set({ updatedAt: new Date() })
    .where(eq(projectsTable.id, scene.projectId));
  res.json(formatScene(scene));
});

router.delete("/scenes/:id", async (req, res) => {
  const { id } = DeleteSceneParams.parse(req.params);
  await db.delete(scenesTable).where(eq(scenesTable.id, id));
  res.status(204).end();
});

export default router;
