/**
 * Native dialog + filesystem IPC handlers.
 *
 * Every handler validates and normalizes paths through the recents
 * store so the renderer never deals with raw OS paths or fs APIs
 * directly — keeping the contextBridge surface tight.
 */
import { BrowserWindow, dialog, type IpcMain } from "electron";
import {
  getLastRecent,
  getRecents,
  recordRecent,
} from "../recents.js";
import type {
  OpenDirectoryOptions,
  OpenFileOptions,
  SaveFileOptions,
} from "@workspace/desktop-bridge";
import * as path from "path";

function activeWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

export function registerDialogHandlers(ipc: IpcMain): void {
  ipc.handle(
    "dialog:openFile",
    async (_e, opts: OpenFileOptions = {}): Promise<string | null> => {
      const win = activeWindow();
      if (!win) return null;
      const defaultPath =
        opts.defaultPath ??
        (opts.rememberKey ? getLastRecent(opts.rememberKey) : undefined);
      const result = await dialog.showOpenDialog(win, {
        title: opts.title ?? "Open file",
        properties: ["openFile"],
        defaultPath,
        filters: opts.filters,
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      const picked = result.filePaths[0];
      if (opts.rememberKey) recordRecent(opts.rememberKey, path.dirname(picked));
      return picked;
    },
  );

  ipc.handle(
    "dialog:openFiles",
    async (_e, opts: OpenFileOptions = {}): Promise<string[]> => {
      const win = activeWindow();
      if (!win) return [];
      const result = await dialog.showOpenDialog(win, {
        title: opts.title ?? "Open files",
        properties: ["openFile", "multiSelections"],
        defaultPath:
          opts.defaultPath ??
          (opts.rememberKey ? getLastRecent(opts.rememberKey) : undefined),
        filters: opts.filters,
      });
      if (result.canceled) return [];
      if (opts.rememberKey && result.filePaths[0]) {
        recordRecent(opts.rememberKey, path.dirname(result.filePaths[0]));
      }
      return result.filePaths;
    },
  );

  ipc.handle(
    "dialog:saveFile",
    async (_e, opts: SaveFileOptions = {}): Promise<string | null> => {
      const win = activeWindow();
      if (!win) return null;
      const defaultDir = opts.rememberKey
        ? getLastRecent(opts.rememberKey)
        : undefined;
      const result = await dialog.showSaveDialog(win, {
        title: opts.title ?? "Save file",
        defaultPath: defaultDir
          ? path.join(defaultDir, opts.defaultName ?? "untitled")
          : opts.defaultName,
        filters: opts.filters,
      });
      if (result.canceled || !result.filePath) return null;
      if (opts.rememberKey) {
        recordRecent(opts.rememberKey, path.dirname(result.filePath));
      }
      return result.filePath;
    },
  );

  ipc.handle(
    "dialog:openDirectory",
    async (_e, opts: OpenDirectoryOptions = {}): Promise<string | null> => {
      const win = activeWindow();
      if (!win) return null;
      const result = await dialog.showOpenDialog(win, {
        title: opts.title ?? "Choose folder",
        properties: ["openDirectory", "createDirectory"],
        defaultPath:
          opts.defaultPath ??
          (opts.rememberKey ? getLastRecent(opts.rememberKey) : undefined),
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      const picked = result.filePaths[0];
      if (opts.rememberKey) recordRecent(opts.rememberKey, picked);
      return picked;
    },
  );

  ipc.handle("fs:recent", (_e, key: string) => getRecents(key));
}
