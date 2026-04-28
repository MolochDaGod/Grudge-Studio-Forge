import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, projectsTable, scenesTable, scriptsTable, assetsTable } from "@workspace/db";
import {
  CreateProjectBody,
  UpdateProjectBody,
  GetProjectParams,
  UpdateProjectParams,
  DeleteProjectParams,
  GetProjectSummaryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/projects", async (_req, res) => {
  const projects = await db.select().from(projectsTable).orderBy(projectsTable.updatedAt);
  res.json(
    projects.map((p) => ({
      ...p,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    })),
  );
});

router.post("/projects", async (req, res) => {
  const body = CreateProjectBody.parse(req.body);
  const [project] = await db
    .insert(projectsTable)
    .values({ name: body.name, description: body.description ?? "" })
    .returning();
  res.status(201).json({
    ...project,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  });
});

router.get("/projects/:id", async (req, res) => {
  const { id } = GetProjectParams.parse(req.params);
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({
    ...project,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  });
});

router.patch("/projects/:id", async (req, res) => {
  const { id } = UpdateProjectParams.parse(req.params);
  const body = UpdateProjectBody.parse(req.body);
  const [project] = await db
    .update(projectsTable)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(projectsTable.id, id))
    .returning();
  if (!project) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({
    ...project,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  });
});

router.delete("/projects/:id", async (req, res) => {
  const { id } = DeleteProjectParams.parse(req.params);
  await db.delete(projectsTable).where(eq(projectsTable.id, id));
  res.status(204).end();
});

router.get("/projects/:id/summary", async (req, res) => {
  const { id } = GetProjectSummaryParams.parse(req.params);
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const [{ count: sceneCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(scenesTable)
    .where(eq(scenesTable.projectId, id));
  const [{ count: scriptCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(scriptsTable)
    .where(eq(scriptsTable.projectId, id));
  const [{ count: assetCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(assetsTable)
    .where(eq(assetsTable.projectId, id));

  const scenes = await db.select().from(scenesTable).where(eq(scenesTable.projectId, id));
  let entityCount = 0;
  for (const s of scenes) {
    const data = s.data as { entities?: unknown[] };
    if (Array.isArray(data?.entities)) entityCount += data.entities.length;
  }

  res.json({
    projectId: id,
    sceneCount,
    scriptCount,
    assetCount,
    entityCount,
    lastUpdated: project.updatedAt.toISOString(),
  });
});

export default router;
