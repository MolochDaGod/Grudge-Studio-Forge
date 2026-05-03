// Preload: exposes a typed `window.desktop` over contextBridge.
import { contextBridge, ipcRenderer, webUtils } from "electron";
import type {
  DesktopAPI,
  ProgressEvent as ToolProgressEvent,
  ProgressListener,
  UpdateListener,
  UpdateState,
} from "@workspace/desktop-bridge";

const progressListeners = new Set<ProgressListener>();
ipcRenderer.on("tool:progress", (_e, payload: ToolProgressEvent) => {
  for (const fn of progressListeners) {
    try {
      fn(payload);
    } catch (err) {
      console.error("progress listener threw", err);
    }
  }
});

// Forward menu commands from the native application menu into DOM
// CustomEvents the renderer already listens for. This keeps the React
// tree free of any direct ipcRenderer dependency — the same window
// events also work in the browser build (where they simply never
// fire), so the handlers in Toolbar.tsx are agnostic to the host.
ipcRenderer.on("menu:openTool", (_e, tab: string) => {
  window.dispatchEvent(new CustomEvent("gameforge:openTool", { detail: tab }));
});
ipcRenderer.on("menu:saveScene", () => {
  window.dispatchEvent(new CustomEvent("gameforge:save"));
});
ipcRenderer.on("menu:openScene", () => {
  window.dispatchEvent(new CustomEvent("gameforge:openScene"));
});

const updateListeners = new Set<UpdateListener>();
ipcRenderer.on("updater:state", (_e, payload: UpdateState) => {
  for (const fn of updateListeners) {
    try {
      fn(payload);
    } catch (err) {
      console.error("update listener threw", err);
    }
  }
});

// Mutable metadata holders. Filled in asynchronously after preload
// boots; the exposed API reads through getters so callers always see
// the latest values without us re-calling exposeInMainWorld (which
// would throw on the second call).
const meta = { version: "0.0.0", platform: process.platform as string };

void Promise.all([
  ipcRenderer.invoke("app:getVersion") as Promise<string>,
  ipcRenderer.invoke("app:getPlatform") as Promise<string>,
]).then(([v, p]) => {
  meta.version = v;
  meta.platform = p;
  window.dispatchEvent(new Event("desktop:ready"));
});

function attach() {
  const api: DesktopAPI = {
    get appVersion() {
      return meta.version;
    },
    get platform() {
      return meta.platform;
    },
    dialog: {
      openFile: (opts) => ipcRenderer.invoke("dialog:openFile", opts),
      openFiles: (opts) => ipcRenderer.invoke("dialog:openFiles", opts),
      saveFile: (opts) => ipcRenderer.invoke("dialog:saveFile", opts),
      openDirectory: (opts) =>
        ipcRenderer.invoke("dialog:openDirectory", opts),
    },
    fs: {
      recent: (key) => ipcRenderer.invoke("fs:recent", key),
      getPathForFile: (file) => webUtils.getPathForFile(file),
    },
    tools: {
      convert3d: (req) => ipcRenderer.invoke("tools:convert3d", req),
      unzip: (req) => ipcRenderer.invoke("tools:unzip", req),
      deployScene: (req) => ipcRenderer.invoke("tools:deployScene", req),
    },
    script: {
      read: (p) => ipcRenderer.invoke("script:read", p),
      write: (p, c) => ipcRenderer.invoke("script:write", p, c),
    },
    updates: {
      check: () => ipcRenderer.invoke("updater:check"),
      onChange: (listener) => {
        updateListeners.add(listener);
        return () => updateListeners.delete(listener);
      },
      quitAndInstall: () => ipcRenderer.invoke("updater:quitAndInstall"),
    },
    onProgress: (listener) => {
      progressListeners.add(listener);
      return () => progressListeners.delete(listener);
    },
  };
  contextBridge.exposeInMainWorld("desktop", api);
}

attach();
