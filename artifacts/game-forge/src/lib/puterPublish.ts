import { loadPuterSdk } from "@/lib/puterSdk";
import type { SceneData } from "@/scene/types";
import type { Script } from "@workspace/api-client-react";

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
  /** Which bootstrapper was uploaded:
   *   - `"player"`: the standalone player bundle (the new path).
   *   - `"redirect"`: the legacy redirect-to-editor HTML (fallback when
   *     the deployed editor doesn't yet serve `/player.html`).
   *  Useful for the publish dialog so the user knows which experience
   *  end-visitors will get. */
  bootstrapper: "player" | "redirect";
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
 * Fetch the standalone player's bundled HTML from the editor origin.
 *
 * The `@workspace/player` build (see `artifacts/player/`) emits a single
 * self-contained `index.html` (JS + CSS inlined) that fetches `./scene.json`
 * on load and renders the scene with no editor chrome. The build's
 * post-step copies it into `artifacts/game-forge/public/player.html`,
 * so the deployed editor serves it at `${editorOrigin}player.html`.
 *
 * We download those bytes at publish time and re-upload them next to the
 * user's `scene.json`. End users opening `<sub>.puter.site/` get the
 * lightweight player — no editor bundle, no inspector chrome — instead
 * of being redirected back to the editor.
 *
 * If the fetch fails (e.g. the editor was deployed before the player
 * bundle existed) we fall back to a redirect to the editor with
 * `?scene=…`, which is what previous publishes shipped.
 */
async function fetchPlayerHtml(editorOrigin: string): Promise<string | null> {
  try {
    const res = await fetch(`${editorOrigin}player.html`, { cache: "no-store" });
    if (!res.ok) return null;
    const text = await res.text();
    // Sanity-check: must be HTML, not the SPA fallback's index.html (which
    // wouldn't fetch ./scene.json at all). Look for a unique marker the
    // player's bundle always contains.
    if (!text.includes("./scene.json") || !text.includes("./scripts.json")) {
      return null;
    }
    return text;
  } catch {
    return null;
  }
}

/** Legacy redirect HTML — used when the player bundle isn't reachable
 *  (older deploys). Kept so older editors don't fail publish. */
function buildLegacyRedirectHtml(editorOrigin: string, sceneUrl: string): string {
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
  /** Scripts referenced by `sceneData` entities. Uploaded next to
   *  `scene.json` as `scripts.json` so the standalone player can run the
   *  same gameplay tick (script `start`/`update`, nav-agent FSMs) the
   *  editor's play mode runs. Omit/empty array → no scripts in the
   *  bundle (the player still renders, just without scripted behavior). */
  scripts?: Script[];
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

  // Always upload scripts.json (even when empty) so the player's fetch
  // gets a 200 instead of a 404 — simpler error handling on the player
  // side, and it overwrites a stale scripts.json from a prior publish
  // where the user has since deleted scripts.
  const scriptsJson = JSON.stringify(opts.scripts ?? []);
  await sdk.fs.write(`${dirPath}/scripts.json`, scriptsJson, { overwrite: true });

  // Try to fetch the standalone player's bundled HTML. If it's available
  // we ship that — end-users get a chrome-free 3D player instead of the
  // full editor. Falls back to the legacy redirect if the deployed
  // editor doesn't yet serve `/player.html`.
  const playerHtml = await fetchPlayerHtml(opts.editorOrigin);
  let bootstrapper: "player" | "redirect";
  let indexHtml: string;
  // The player bundle fetches a relative `./scene.json`, so it's slug-
  // independent and we don't need to know the eventual subdomain at
  // upload time. The legacy redirect needs the absolute URL — for that
  // path we use the requested slug (Puter has historically respected
  // it; we re-upload below if it ever doesn't).
  if (playerHtml) {
    bootstrapper = "player";
    indexHtml = playerHtml;
  } else {
    bootstrapper = "redirect";
    const provisionalSceneUrl = `https://${sub}.puter.site/scene.json`;
    indexHtml = buildLegacyRedirectHtml(opts.editorOrigin, provisionalSceneUrl);
  }
  await sdk.fs.write(`${dirPath}/index.html`, indexHtml, { overwrite: true });

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

  // If Puter renamed our slug AND we shipped the legacy redirect (which
  // hard-codes the scene URL), re-upload with the corrected URL so the
  // redirect doesn't 404. The player bundle fetches `./scene.json`
  // relative to the page so it doesn't care which subdomain it lives on.
  if (createdSub !== sub && bootstrapper === "redirect") {
    const correctSceneUrl = `https://${createdSub}.puter.site/scene.json`;
    await sdk.fs.write(
      `${dirPath}/index.html`,
      buildLegacyRedirectHtml(opts.editorOrigin, correctSceneUrl),
      { overwrite: true },
    );
  }

  const sceneUrl = `https://${createdSub}.puter.site/scene.json`;
  const shareUrl = `https://${createdSub}.puter.site/`;
  return { shareUrl, sceneUrl, subdomain: createdSub, reused, bootstrapper };
}
