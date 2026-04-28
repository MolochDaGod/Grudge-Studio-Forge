import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, assetsTable } from "@workspace/db";
import {
  CreateAssetBody,
  DeleteAssetParams,
  ListAssetsParams,
} from "@workspace/api-zod";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

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

/**
 * Delete an asset row. If the asset was uploaded through our object storage
 * (source = "upload" and url points at /api/storage/objects/...), also delete
 * the underlying object so the bucket doesn't accumulate orphans.
 */
router.delete("/assets/:id", async (req, res) => {
  const { id } = DeleteAssetParams.parse(req.params);

  const [existing] = await db
    .select()
    .from(assetsTable)
    .where(eq(assetsTable.id, id));

  await db.delete(assetsTable).where(eq(assetsTable.id, id));

  if (existing && existing.source === "upload") {
    const objectPath = extractObjectPath(existing.url);
    if (objectPath) {
      try {
        await objectStorageService.deleteObjectEntity(objectPath);
      } catch (err) {
        req.log.warn(
          { err, assetId: id, url: existing.url },
          "Failed to delete underlying storage object",
        );
      }
    }
  }

  res.status(204).end();
});

/**
 * Pull "/objects/<...>" out of a serving URL. Accepts either a bare
 * "/objects/x" or a prefixed "/api/storage/objects/x".
 */
function extractObjectPath(url: string): string | null {
  if (url.startsWith("/objects/")) return url;
  const idx = url.indexOf("/objects/");
  if (idx === -1) return null;
  return url.slice(idx);
}

export default router;
