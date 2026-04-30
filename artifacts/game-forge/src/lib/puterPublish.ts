import { loadPuterSdk } from "@/lib/puterSdk";
import type { SceneData } from "@/scene/types";

/**
 * Publish a scene as a free, sharable static site on Puter.
 *
 * The flow:
 *   1. Build a *stable* slug derived from the scene id (or a content
 *      hash of the scene data for unsaved drafts) so re-publishing the
 *      same scene reuses the same `<sub>.puter.site` URL — bookmarked
 *      links keep working, and "Publish" effectively becomes "push
 *      update". Importantly, the slug never includes the scene NAME so
 *      renaming a saved scene does not break the bookmark.
 *   2. Make the directory `Grudge/published/<slug>/` under the user's
 *      Puter cloud (idempotent — `createMissingParents`, no overwrite).
 *   3. Write `scene.json` + `index.html` (overwrite=true so subsequent
 *      publishes update content in place).
 *   4. Call `puter.hosting.create(<sub>, <dir>)`. If the subdomain is
 *      already mounted to that directory (we own it from a prior
 *      publish) treat that as success rather than an error.
 *   5. Build the final share URL from the *returned* subdomain in case
 *      Puter normalised our requested slug.
 *
 * Failure modes are explicit: if the user is signed out we throw, if
 * the SDK can't be loaded we throw, and if hosting isn't available on
 * this SDK build we throw with a hint to upgrade.
 */
export interface PublishResult {
  /** Public bootstrapper URL — share this with players. */
  shareUrl: string;
  /** Direct URL to the raw scene JSON (also publicly readable). */
  sceneUrl: string;
  /** The Puter subdomain that was created (e.g. "grudge-arena-abc1"). */
  subdomain: string;
  /** True when this publish reused a previously created subdomain
   *  rather than creating a fresh one. Useful for the dialog copy. */
  reused: boolean;
}

/** Cheap, stable, browser-only string hash (FNV-1a 32-bit, hex). Same
 *  scene name on two different machines collides; that's fine — we
 *  combine with sceneId where available. */
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(7, "0").slice(0, 7);
}

/** Build a stable Puter subdomain slug for a scene.
 *
 *  Stability requirement (T005): re-publishing the *same* scene must
 *  yield the *same* URL so bookmarked links keep working. That means
 *  the slug must NOT depend on anything the user can change between
 *  publishes — most importantly, the scene name. Saved scenes therefore
 *  key purely off `sceneId` (the immutable database primary key);
 *  renaming the scene leaves the slug untouched.
 *
 *  Unsaved scratch scenes have no id, so we fall back to a content hash
 *  of the canonicalized `sceneData` JSON. Two clicks of Publish on the
 *  same content map to the same slug; *any* edit produces a fresh URL
 *  (which is the right behavior for ephemeral, never-saved drafts).
 */
function stableSlug(opts: {
  sceneId: number | null | undefined;
  sceneData: SceneData;
}): string {
  if (opts.sceneId != null && Number.isFinite(opts.sceneId)) {
    // `forge-scene-<id36>` — short, URL-safe, name-independent.
    return `forge-scene-${opts.sceneId.toString(36)}`;
  }
  // Anonymous draft — hash the actual scene content so the slug is
  // determined by what the user is publishing, not by an ephemeral name.
  return `forge-draft-${fnv1a(JSON.stringify(opts.sceneData))}`;
}

/**
 * Boot HTML for the published site. Redirects the visitor back to the
 * editor with the scene URL as a query param. The editor reads `?scene=`
 * at boot, fetches the JSON, and starts in play mode.
 *
 * We use a redirect (rather than embedding the editor in an iframe) so
 * the user gets the full editor URL in their address bar — easier to
 * bookmark and share, and avoids cross-origin headaches.
 */
function buildIndexHtml(editorOrigin: string, sceneUrl: string): string {
  const target = `${editorOrigin}?scene=${encodeURIComponent(sceneUrl)}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Loading scene…</title>
<meta http-equiv="refresh" content="0; url=${target}" />
<style>
  body{background:#0a0a14;color:#e8dfc8;font-family:system-ui,sans-serif;
       display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}
  a{color:#d4af37}
</style>
</head>
<body>
<p>Opening your Grudge scene… <a href="${target}">click here</a> if it does not redirect.</p>
<script>location.replace(${JSON.stringify(target)});</script>
</body>
</html>`;
}

export async function publishScene(opts: {
  sceneData: SceneData;
  /** Forge scene primary key when persisted; null/undefined for
   *  unsaved scratch scenes. Used to keep the published URL stable. */
  sceneId?: number | null;
  /** Origin (with trailing slash, including BASE_URL) the bootstrapper
   *  HTML should redirect back to. e.g. `${location.origin}${BASE_URL}`. */
  editorOrigin: string;
}): Promise<PublishResult> {
  const sdk = await loadPuterSdk();
  const signedIn = await sdk.auth.isSignedIn();
  if (!signedIn) {
    throw new Error("Sign in with Puter before publishing.");
  }
  if (!sdk.hosting || typeof sdk.hosting.create !== "function") {
    throw new Error(
      "This Puter SDK build does not expose hosting; please refresh to load the latest SDK.",
    );
  }

  const sub = stableSlug({
    sceneId: opts.sceneId ?? null,
    sceneData: opts.sceneData,
  });
  const dirPath = `Grudge/published/${sub}`;

  // mkdir is recursive via createMissingParents — safe to call without
  // pre-checking that `Grudge/` or `Grudge/published/` exists. We do
  // NOT pass overwrite=true: that would clobber the directory between
  // the time we create it and the time we write children into it.
  await sdk.fs
    .mkdir(dirPath, { createMissingParents: true, overwrite: false })
    // Already exists from a prior publish — fine, we re-use it.
    .catch(() => undefined);

  const sceneJson = JSON.stringify(opts.sceneData);
  await sdk.fs.write(`${dirPath}/scene.json`, sceneJson, { overwrite: true });

  // We need the eventual public URL of scene.json before uploading the
  // index.html that references it. We *think* it'll be served at the
  // requested subdomain; if Puter renames it during `hosting.create`
  // we re-upload index.html with the corrected URL below. (Puter has
  // historically respected the requested slug verbatim, so the rewrite
  // path is a defensive fallback rather than the common case.)
  const provisionalSceneUrl = `https://${sub}.puter.site/scene.json`;
  await sdk.fs.write(
    `${dirPath}/index.html`,
    buildIndexHtml(opts.editorOrigin, provisionalSceneUrl),
    { overwrite: true },
  );

  // hosting.create may legitimately reject with "subdomain already in
  // use" when we re-publish — that's our own previous publish, so
  // treat it as a no-op success and reuse the existing mount.
  let createdSub = sub;
  let reused = false;
  try {
    const created = await sdk.hosting.create(sub, dirPath);
    createdSub = created.subdomain || sub;
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    // The Puter SDK's error shape varies across builds (sometimes
    // `{ code: "subdomain_exists" }`, sometimes a plain Error with the
    // word "already" in it). Match defensively.
    const looksLikeAlreadyOwned =
      /already|exist|in use|taken/i.test(msg) ||
      (err as { code?: string })?.code === "subdomain_exists";
    if (!looksLikeAlreadyOwned) throw err;
    reused = true;
  }

  // If the actual subdomain differs from what we requested, re-upload
  // index.html with the corrected sceneUrl so the redirect doesn't
  // 404. The cheap path (Puter respected the slug) is a no-op.
  if (createdSub !== sub) {
    const correctSceneUrl = `https://${createdSub}.puter.site/scene.json`;
    await sdk.fs.write(
      `${dirPath}/index.html`,
      buildIndexHtml(opts.editorOrigin, correctSceneUrl),
      { overwrite: true },
    );
  }

  const sceneUrl = `https://${createdSub}.puter.site/scene.json`;
  const shareUrl = `https://${createdSub}.puter.site/`;
  return { shareUrl, sceneUrl, subdomain: createdSub, reused };
}
