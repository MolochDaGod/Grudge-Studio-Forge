/**
 * Scene schema types — re-exported from the shared `@workspace/scene-schema`
 * lib so the api-server, scene-templates lib, and the editor agree on a single
 * canonical shape.
 *
 * Existing in-editor imports of the form
 *   import type { SceneEntity } from "@/scene/types"
 * keep working untouched — they resolve here, and we re-export everything
 * the schema lib defines.
 */
export * from "@workspace/scene-schema";
