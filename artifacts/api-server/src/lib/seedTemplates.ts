/**
 * Built-in scene template seeder.
 *
 * On boot we materialize every entry in {@link SCENE_TEMPLATES} into the
 * public object-storage bucket at
 *   templates/<TEMPLATES_VERSION>/<key>.gfscene.json
 *
 * The path is *versioned* — bumping {@link TEMPLATES_VERSION} in
 * `lib/scene-templates` writes a fresh immutable copy without touching
 * older versions, so any existing share links still resolve.
 *
 * The result of seeding is cached in a module-level manifest the
 * `/templates` REST routes read from, so requests don't have to re-run
 * the builders on every hit (the builders are pure, but constructing
 * 24-entity scenes adds latency we can avoid).
 */
import {
  SCENE_TEMPLATES,
  TEMPLATES_VERSION,
  withIdScope,
  type TemplateApiManifest,
} from "@workspace/scene-templates";
import { logger } from "./logger";
import { ObjectStorageService } from "./objectStorage";

let cachedManifest: TemplateApiManifest[] | null = null;

export function templatesObjectKey(key: string): string {
  return `templates/${TEMPLATES_VERSION}/${key}.gfscene.json`;
}

export function getCachedManifest(): TemplateApiManifest[] | null {
  return cachedManifest;
}

/**
 * Idempotently upload every built-in template to the public object
 * storage bucket and populate the cached API manifest. Safe to call
 * concurrently — the underlying `ensurePublicJson` is a no-op when the
 * existing object's byte size matches the payload.
 *
 * Failures on individual templates are logged but do NOT abort boot.
 * The manifest will simply omit the failed entry; the editor's picker
 * will not show templates that didn't make it. Boot crashing on a flaky
 * cloud-storage call would be much worse for the user.
 */
export async function seedTemplates(): Promise<TemplateApiManifest[]> {
  const storage = new ObjectStorageService();
  const manifest: TemplateApiManifest[] = [];

  for (const tpl of SCENE_TEMPLATES) {
    try {
      // Scope the ID counter per-template so the same key+version always
      // serializes to byte-identical JSON (see `withIdScope` for why).
      const sceneData = withIdScope(`${TEMPLATES_VERSION}/${tpl.key}`, () =>
        tpl.build(),
      );
      const json = JSON.stringify(sceneData);
      const objectKey = templatesObjectKey(tpl.key);
      const start = Date.now();
      const result = await storage.ensurePublicJson(objectKey, json);
      manifest.push({
        key: tpl.key,
        label: tpl.label,
        description: tpl.description,
        entityCount: sceneData.entities.length,
        byteSize: result.byteSize,
        storagePath: objectKey,
        version: TEMPLATES_VERSION,
      });
      logger.info(
        {
          tpl: tpl.key,
          version: TEMPLATES_VERSION,
          bytes: result.byteSize,
          entities: sceneData.entities.length,
          written: result.written,
          ms: Date.now() - start,
        },
        result.written
          ? "Template uploaded to object storage"
          : "Template already up-to-date — skipped upload",
      );
    } catch (err) {
      logger.error(
        { err, tpl: tpl.key, version: TEMPLATES_VERSION },
        "Failed to seed template — picker will omit this entry",
      );
    }
  }

  cachedManifest = manifest;
  return manifest;
}
