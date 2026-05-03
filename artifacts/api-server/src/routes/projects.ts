import { Router, type IRouter, type RequestHandler } from "express";
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

function isUndefinedTableError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "42P01"
  );
}

function withDbErrors(handler: RequestHandler): RequestHandler {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (err) {
      if (isUndefinedTableError(err)) {
        req.log?.error(
          { err },
          "Forge tables missing — run `pnpm --filter @workspace/db run migrate`",
        );
        res.status(503).json({
          error: "Database not migrated",
          message:
            "The forge_* tables do not exist in this database. Run `pnpm --filter @workspace/db run migrate` to create them.",
          code: "DB_NOT_MIGRATED",
        });
        return;
      }
      next(err);
    }
  };
}

router.get(
  "/projects",
  withDbErrors(async (_req, res) => {
    const projects = await db.select().from(projectsTable).orderBy(projectsTable.updatedAt);
    res.json(
      projects.map((p) => ({
        ...p,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      })),
    );
  }),
);

router.post(
  "/projects",
  withDbErrors(async (req, res) => {
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
  }),
);

router.get(
  "/projects/:id",
  withDbErrors(async (req, res) => {
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
  }),
);

router.patch(
  "/projects/:id",
  withDbErrors(async (req, res) => {
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
  }),
);

router.delete(
  "/projects/:id",
  withDbErrors(async (req, res) => {
    const { id } = DeleteProjectParams.parse(req.params);
    await db.delete(projectsTable).where(eq(projectsTable.id, id));
    res.status(204).end();
  }),
);

router.get(
  "/projects/:id/summary",
  withDbErrors(async (req, res) => {
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
  }),
);

export default router;
