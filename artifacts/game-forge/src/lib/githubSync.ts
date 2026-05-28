/**
 * GitHub Project Sync — push/pull Forge project state to/from a GitHub repo.
 *
 * Serializes scenes, scripts, and prefabs into a standardized folder structure,
 * then pushes via the GitHub Contents API. Pulls deserialize back into the editor.
 *
 * File structure on GitHub:
 *   project-name/
 *     forge.project.json         # Project metadata + Forge version
 *     scenes/
 *       main.gfscene.json        # Scene data (entities + environment)
 *     scripts/
 *       001-player-health.js     # Numbered script files
 *       002-enemy-patrol.js
 *     prefabs/
 *       player.prefab.json       # Prefab entity trees
 *       enemy-group.prefab.json
 *
 * Auth: uses a GitHub personal access token (PAT) stored in localStorage.
 * The token is never sent to the Forge API server — all GitHub calls are
 * direct from the browser to api.github.com.
 */

import type { SceneData } from "@/scene/types";

// ── Types ────────────────────────────────────────────────────────────

export interface GitHubConnection {
  owner: string;
  repo: string;
  branch: string;
  /** Path prefix inside the repo (e.g. "projects/my-game"). Empty = repo root. */
  basePath: string;
}

export interface ProjectManifest {
  forgeVersion: string;
  projectName: string;
  sceneName: string;
  entityCount: number;
  scriptCount: number;
  prefabCount: number;
  lastPushedAt: string;
}

interface GitHubFile {
  path: string;
  content: string;
}

interface ScriptData {
  id: number;
  name: string;
  language: string;
  code: string;
}

interface PrefabData {
  id: number;
  name: string;
  kind: string;
  data: unknown;
}

// ── Token management ─────────────────────────────────────────────────

const TOKEN_KEY = "grudge.github.pat";

export function getGitHubToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setGitHubToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* private mode */
  }
}

export function clearGitHubToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode */
  }
}

// ── Connection management ────────────────────────────────────────────

const CONN_KEY_PREFIX = "grudge.github.conn.";

export function getConnection(projectId: number): GitHubConnection | null {
  try {
    const raw = localStorage.getItem(CONN_KEY_PREFIX + projectId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setConnection(projectId: number, conn: GitHubConnection): void {
  try {
    localStorage.setItem(CONN_KEY_PREFIX + projectId, JSON.stringify(conn));
  } catch {
    /* private mode */
  }
}

// ── GitHub API helpers ───────────────────────────────────────────────

async function githubFetch(
  path: string,
  opts: RequestInit & { token: string },
): Promise<Response> {
  const { token, ...rest } = opts;
  return fetch(`https://api.github.com${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...((rest.headers as Record<string, string>) ?? {}),
    },
  });
}

/** Base64 encode for GitHub Contents API. */
function b64(s: string): string {
  return btoa(unescape(encodeURIComponent(s)));
}

// ── Serialization ────────────────────────────────────────────────────

function toKebab(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "untitled";
}

export function serializeProject(opts: {
  projectName: string;
  sceneName: string;
  sceneData: SceneData;
  scripts: ScriptData[];
  prefabs: PrefabData[];
  basePath: string;
}): GitHubFile[] {
  const { projectName, sceneName, sceneData, scripts, prefabs, basePath } = opts;
  const prefix = basePath ? `${basePath}/` : "";
  const files: GitHubFile[] = [];

  // Project manifest
  const manifest: ProjectManifest = {
    forgeVersion: "0.2.0",
    projectName,
    sceneName,
    entityCount: sceneData.entities.length,
    scriptCount: scripts.length,
    prefabCount: prefabs.length,
    lastPushedAt: new Date().toISOString(),
  };
  files.push({
    path: `${prefix}forge.project.json`,
    content: JSON.stringify(manifest, null, 2),
  });

  // Scene
  files.push({
    path: `${prefix}scenes/${toKebab(sceneName)}.gfscene.json`,
    content: JSON.stringify(sceneData, null, 2),
  });

  // Scripts (numbered for stable ordering)
  for (let i = 0; i < scripts.length; i++) {
    const s = scripts[i];
    const num = String(i + 1).padStart(3, "0");
    const ext = s.language === "cs" ? "cs" : "js";
    const safeName = toKebab(s.name);
    files.push({
      path: `${prefix}scripts/${num}-${safeName}.${ext}`,
      content: s.code,
    });
  }

  // Script index (maps IDs to filenames for round-trip fidelity)
  if (scripts.length > 0) {
    files.push({
      path: `${prefix}scripts/_index.json`,
      content: JSON.stringify(
        scripts.map((s, i) => ({
          id: s.id,
          name: s.name,
          language: s.language,
          file: `${String(i + 1).padStart(3, "0")}-${toKebab(s.name)}.${s.language === "cs" ? "cs" : "js"}`,
        })),
        null,
        2,
      ),
    });
  }

  // Prefabs
  for (const p of prefabs) {
    files.push({
      path: `${prefix}prefabs/${toKebab(p.name)}.prefab.json`,
      content: JSON.stringify({ id: p.id, name: p.name, kind: p.kind, data: p.data }, null, 2),
    });
  }

  return files;
}

// ── Push to GitHub ───────────────────────────────────────────────────

export interface PushResult {
  commitSha: string;
  filesCount: number;
  url: string;
}

export async function pushToGithub(opts: {
  conn: GitHubConnection;
  files: GitHubFile[];
  message: string;
  token: string;
}): Promise<PushResult> {
  const { conn, files, message, token } = opts;

  // Get the current commit SHA of the branch
  const refRes = await githubFetch(
    `/repos/${conn.owner}/${conn.repo}/git/ref/heads/${conn.branch}`,
    { token },
  );
  if (!refRes.ok) {
    const err = await refRes.text();
    throw new Error(`Failed to get branch ref: ${refRes.status} ${err}`);
  }
  const refData = (await refRes.json()) as { object: { sha: string } };
  const parentSha = refData.object.sha;

  // Get the tree SHA of the parent commit
  const commitRes = await githubFetch(
    `/repos/${conn.owner}/${conn.repo}/git/commits/${parentSha}`,
    { token },
  );
  if (!commitRes.ok) throw new Error(`Failed to get parent commit`);
  const commitData = (await commitRes.json()) as { tree: { sha: string } };
  const baseTreeSha = commitData.tree.sha;

  // Create blobs for each file
  const treeEntries: Array<{
    path: string;
    mode: string;
    type: string;
    sha: string;
  }> = [];

  for (const file of files) {
    const blobRes = await githubFetch(
      `/repos/${conn.owner}/${conn.repo}/git/blobs`,
      {
        token,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: file.content, encoding: "utf-8" }),
      },
    );
    if (!blobRes.ok) throw new Error(`Failed to create blob for ${file.path}`);
    const blobData = (await blobRes.json()) as { sha: string };
    treeEntries.push({
      path: file.path,
      mode: "100644",
      type: "blob",
      sha: blobData.sha,
    });
  }

  // Create tree
  const treeRes = await githubFetch(
    `/repos/${conn.owner}/${conn.repo}/git/trees`,
    {
      token,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
    },
  );
  if (!treeRes.ok) throw new Error(`Failed to create tree`);
  const treeData = (await treeRes.json()) as { sha: string };

  // Create commit
  const newCommitRes = await githubFetch(
    `/repos/${conn.owner}/${conn.repo}/git/commits`,
    {
      token,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        tree: treeData.sha,
        parents: [parentSha],
      }),
    },
  );
  if (!newCommitRes.ok) throw new Error(`Failed to create commit`);
  const newCommit = (await newCommitRes.json()) as { sha: string };

  // Update branch ref
  const updateRes = await githubFetch(
    `/repos/${conn.owner}/${conn.repo}/git/refs/heads/${conn.branch}`,
    {
      token,
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha: newCommit.sha }),
    },
  );
  if (!updateRes.ok) throw new Error(`Failed to update branch ref`);

  return {
    commitSha: newCommit.sha,
    filesCount: files.length,
    url: `https://github.com/${conn.owner}/${conn.repo}/commit/${newCommit.sha}`,
  };
}

// ── Pull from GitHub ─────────────────────────────────────────────────

export interface PullResult {
  manifest: ProjectManifest;
  sceneData: SceneData | null;
  scripts: Array<{ name: string; language: string; code: string }>;
}

export async function pullFromGithub(opts: {
  conn: GitHubConnection;
  token: string;
}): Promise<PullResult> {
  const { conn, token } = opts;
  const prefix = conn.basePath ? `${conn.basePath}/` : "";

  // Fetch manifest
  const manifestRes = await githubFetch(
    `/repos/${conn.owner}/${conn.repo}/contents/${prefix}forge.project.json?ref=${conn.branch}`,
    { token },
  );
  if (!manifestRes.ok) throw new Error("No forge.project.json found in repo");
  const manifestFile = (await manifestRes.json()) as { content: string };
  const manifest = JSON.parse(atob(manifestFile.content)) as ProjectManifest;

  // Fetch scene files
  let sceneData: SceneData | null = null;
  try {
    const scenesRes = await githubFetch(
      `/repos/${conn.owner}/${conn.repo}/contents/${prefix}scenes?ref=${conn.branch}`,
      { token },
    );
    if (scenesRes.ok) {
      const sceneFiles = (await scenesRes.json()) as Array<{
        name: string;
        download_url: string;
      }>;
      const gfscene = sceneFiles.find((f) => f.name.endsWith(".gfscene.json"));
      if (gfscene?.download_url) {
        const sceneRes = await fetch(gfscene.download_url);
        sceneData = (await sceneRes.json()) as SceneData;
      }
    }
  } catch {
    /* no scenes dir */
  }

  // Fetch scripts
  const scripts: PullResult["scripts"] = [];
  try {
    const scriptsRes = await githubFetch(
      `/repos/${conn.owner}/${conn.repo}/contents/${prefix}scripts?ref=${conn.branch}`,
      { token },
    );
    if (scriptsRes.ok) {
      const scriptFiles = (await scriptsRes.json()) as Array<{
        name: string;
        download_url: string;
      }>;
      for (const sf of scriptFiles) {
        if (sf.name === "_index.json" || !sf.download_url) continue;
        const ext = sf.name.split(".").pop() ?? "js";
        const language = ext === "cs" ? "cs" : "js";
        // Strip leading number prefix: "001-player-health.js" → "player-health"
        const name = sf.name
          .replace(/^\d+-/, "")
          .replace(/\.(js|cs)$/, "")
          .replace(/-/g, " ");
        try {
          const codeRes = await fetch(sf.download_url);
          const code = await codeRes.text();
          scripts.push({ name, language, code });
        } catch {
          /* skip unreadable script */
        }
      }
    }
  } catch {
    /* no scripts dir */
  }

  return { manifest, sceneData, scripts };
}

// ── Commit message generation ────────────────────────────────────────

export function generateCommitMessage(opts: {
  sceneName: string;
  entityCount: number;
  scriptCount: number;
  prefabCount: number;
}): string {
  const parts = [
    `scene: ${opts.sceneName}`,
    `${opts.entityCount} entities`,
    `${opts.scriptCount} scripts`,
    `${opts.prefabCount} prefabs`,
  ];
  return `forge: update ${parts.join(", ")}`;
}

// ── Validate connection ──────────────────────────────────────────────

export async function validateConnection(
  conn: GitHubConnection,
  token: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await githubFetch(
      `/repos/${conn.owner}/${conn.repo}`,
      { token },
    );
    if (!res.ok) {
      return { ok: false, error: `Repo not found or no access (${res.status})` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
