// Electron main process: window, app menu, IPC wiring, auto-update.
import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  shell,
  type MenuItemConstructorOptions,
} from "electron";
import * as path from "path";
import * as fs from "fs/promises";
import { fileURLToPath } from "url";
import { registerToolHandlers } from "./ipc/tools.js";
import { registerDialogHandlers } from "./ipc/dialogs.js";
import { registerScriptHandlers } from "./ipc/script.js";
import { UpdateManager } from "./update-manager.js";

// ESM-safe replacement for __dirname (this file is emitted as an ES module).
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let updateManager: UpdateManager | null = null;

const DEV_URL = process.env.GAMEFORGE_DEV_URL;

function rendererIndex(): string {
  // In dev we load Vite directly. In packaged builds the renderer is in
  // `process.resourcesPath/renderer/index.html` (see electron-builder.yml).
  if (DEV_URL) return DEV_URL;
  return path.join(process.resourcesPath, "renderer", "index.html");
}

async function createMainWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: "Grudge GameForge",
    backgroundColor: "#0a0a0a",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow = win;

  win.on("closed", () => {
    mainWindow = null;
  });

  // External links open in the user's default browser, never inside the
  // shell — prevents accidental navigation that could trap the user
  // outside the editor.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (DEV_URL) {
    await win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    await win.loadFile(rendererIndex());
  }
}

function buildMenu() {
  const isMac = process.platform === "darwin";

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: "&File",
      submenu: [
        {
          label: "Open Scene…",
          accelerator: "CmdOrCtrl+O",
          click: () => {
            mainWindow?.webContents.send("menu:openScene");
          },
        },
        {
          label: "Save Scene",
          accelerator: "CmdOrCtrl+S",
          click: () => {
            mainWindow?.webContents.send("menu:saveScene");
          },
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "&Tools",
      submenu: [
        {
          label: "3D Converter",
          click: () =>
            mainWindow?.webContents.send("menu:openTool", "converter"),
        },
        {
          label: "Unzipper",
          click: () =>
            mainWindow?.webContents.send("menu:openTool", "unzipper"),
        },
        {
          label: "Scene Deployer",
          click: () =>
            mainWindow?.webContents.send("menu:openTool", "deployer"),
        },
        {
          label: "Three.js Script Editor",
          click: () =>
            mainWindow?.webContents.send("menu:openTool", "scripts"),
        },
      ],
    },
    {
      label: "&View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "&Help",
      submenu: [
        {
          label: "Check for Updates…",
          click: async () => {
            const state = await updateManager?.checkNow();
            if (state?.status === "uptodate" && mainWindow) {
              await dialog.showMessageBox(mainWindow, {
                type: "info",
                title: "Up to date",
                message: `You're on Grudge GameForge ${app.getVersion()}.`,
              });
            }
          },
        },
        {
          label: "Open App Folder",
          click: async () => {
            await shell.openPath(app.getPath("userData"));
          },
        },
        { type: "separator" },
        {
          label: "About Grudge GameForge",
          click: async () => {
            if (!mainWindow) return;
            await dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "About",
              message: `Grudge GameForge ${app.getVersion()}`,
              detail:
                "Native Windows build of Grudge GameForge. Built on Electron with on-disk 3D tools.",
            });
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function bootstrap() {
  // Make sure userData exists (used by electron-store and recents).
  await fs.mkdir(app.getPath("userData"), { recursive: true });

  registerDialogHandlers(ipcMain);
  registerToolHandlers(ipcMain, () => mainWindow);
  registerScriptHandlers(ipcMain);

  // App-level metadata exposed to the renderer.
  ipcMain.handle("app:getVersion", () => app.getVersion());
  ipcMain.handle("app:getPlatform", () => process.platform);

  // Updater IPC — wired here so the preload's `window.desktop.updates`
  // surface has matching handlers. The preload calls
  // `updater:check` and `updater:quitAndInstall`; without these
  // handlers those invocations would reject at runtime.
  ipcMain.handle("updater:check", async () => {
    if (!updateManager) return { status: "idle" as const };
    return updateManager.checkNow();
  });
  ipcMain.handle("updater:quitAndInstall", async () => {
    await updateManager?.quitAndInstall();
  });

  buildMenu();
  await createMainWindow();

  if (mainWindow) {
    updateManager = new UpdateManager(mainWindow);
    void updateManager.checkOnLaunch();
  }
}

app.whenReady().then(bootstrap).catch((err) => {
  console.error("Failed to start GameForge:", err);
  app.exit(1);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
});
