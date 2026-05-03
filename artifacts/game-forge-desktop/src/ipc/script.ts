/**
 * Script editor IPC: load and save .js / .ts files from disk.
 *
 * Kept separate from the generic `fs:readText` / `fs:writeText`
 * channels so the renderer's Script Editor can be hardened later
 * (e.g. enforce extension filters, attach autosave snapshots) without
 * touching the lower-level file IO surface.
 */
import type { IpcMain } from "electron";
import * as fs from "fs/promises";
import * as path from "path";
import type { ScriptFileResult } from "@workspace/desktop-bridge";
import { recordRecent } from "../recents.js";

const ALLOWED_EXTS = new Set([".js", ".ts", ".mjs", ".cjs"]);
const RECENT_KEY = "scripts.files";

function assertScriptPath(p: string) {
  const ext = path.extname(p).toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) {
    throw new Error(`Refusing to read non-script file: ${p}`);
  }
}

export function registerScriptHandlers(ipc: IpcMain): void {
  ipc.handle("script:read", async (_e, p: string): Promise<ScriptFileResult> => {
    assertScriptPath(p);
    const content = await fs.readFile(p, "utf8");
    recordRecent(RECENT_KEY, p);
    return { path: p, content };
  });

  ipc.handle("script:write", async (_e, p: string, contents: string) => {
    assertScriptPath(p);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, contents, "utf8");
    recordRecent(RECENT_KEY, p);
  });
}
