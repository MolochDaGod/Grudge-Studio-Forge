/**
 * Thin wrapper around electron-updater that:
 *   - checks for updates on launch (silent unless one is found),
 *   - re-checks on demand from Help → Check for Updates,
 *   - streams update lifecycle to the renderer over the
 *     `updater:state` channel so the React UI can render toasts.
 *
 * The publish feed is configured in electron-builder.yml via the
 * `publish: github` block. At runtime electron-updater fetches the
 * matching `latest.yml` from that GitHub Releases asset list.
 */
import type { BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import type { UpdateState } from "@workspace/desktop-bridge";

export class UpdateManager {
  private win: BrowserWindow;
  private state: UpdateState = { status: "idle" };

  constructor(win: BrowserWindow) {
    this.win = win;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("checking-for-update", () =>
      this.set({ status: "checking" }),
    );
    autoUpdater.on("update-available", (info) =>
      this.set({
        status: "available",
        version: info.version,
        message: `Update ${info.version} available — downloading…`,
      }),
    );
    autoUpdater.on("update-not-available", (info) =>
      this.set({ status: "uptodate", version: info.version }),
    );
    autoUpdater.on("download-progress", (p) =>
      this.set({
        status: "downloading",
        progress: p.percent / 100,
        message: `Downloading… ${Math.round(p.percent)}%`,
      }),
    );
    autoUpdater.on("update-downloaded", (info) =>
      this.set({
        status: "downloaded",
        version: info.version,
        message: `Update ${info.version} ready — restart to install.`,
      }),
    );
    autoUpdater.on("error", (err) =>
      this.set({ status: "error", message: err.message }),
    );
  }

  private set(s: UpdateState) {
    this.state = s;
    if (!this.win.isDestroyed()) {
      this.win.webContents.send("updater:state", s);
    }
  }

  async checkOnLaunch(): Promise<void> {
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      // Network failures on launch are non-fatal; the user can retry
      // via Help → Check for Updates.
      this.set({ status: "error", message: (err as Error).message });
    }
  }

  async checkNow(): Promise<UpdateState> {
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      this.set({ status: "error", message: (err as Error).message });
    }
    return this.state;
  }

  async quitAndInstall(): Promise<void> {
    autoUpdater.quitAndInstall();
  }
}
