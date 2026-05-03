/**
 * @workspace/desktop-bridge
 *
 * Shared typed surface that lets the same React tree run unmodified in
 * both the browser (`@workspace/game-forge`) and the Electron Windows
 * shell (`@workspace/game-forge-desktop`).
 *
 * The desktop preload script attaches a `window.desktop` object that
 * implements `DesktopAPI`. In the web build the global is absent, so
 * `useDesktopBridge()` returns `null` and any UI that requires native
 * disk access can render a "Desktop only" placeholder instead.
 *
 * Keeping this contract in a tiny shared lib (rather than ad-hoc typing
 * inside game-forge) means the Electron preload can `import type` from
 * the same source of truth, eliminating drift between renderer and main
 * process.
 */
import { useEffect, useState } from "react";

export type ThreeDFormat = "glb" | "gltf" | "fbx" | "obj" | "stl";

export interface OpenFileOptions {
  title?: string;
  filters?: { name: string; extensions: string[] }[];
  defaultPath?: string;
  rememberKey?: string;
}

export interface SaveFileOptions {
  title?: string;
  defaultName?: string;
  filters?: { name: string; extensions: string[] }[];
  rememberKey?: string;
}

export interface OpenDirectoryOptions {
  title?: string;
  defaultPath?: string;
  rememberKey?: string;
}

export interface Convert3dRequest {
  inputPath: string;
  outputDir: string;
  outputName?: string;
  targetFormat: ThreeDFormat;
}

export interface Convert3dResult {
  outputPath: string;
  bytesWritten: number;
  warnings: string[];
}

export interface UnzipRequest {
  zipPath: string;
  outputDir: string;
}

export interface UnzipResult {
  files: string[];
  totalBytes: number;
}

export interface DeploySceneRequest {
  outputDir: string;
  zip: boolean;
  /** Serialized scene JSON the renderer already produced. */
  sceneJson: string;
  /** Display name used inside the generated index.html title. */
  sceneName: string;
  /** Optional referenced asset URLs to copy into the deploy folder. */
  assetUrls?: string[];
}

export interface DeploySceneResult {
  folderPath: string;
  zipPath: string | null;
  fileCount: number;
}

export interface ScriptFileResult {
  path: string;
  content: string;
}

export interface ProgressEvent {
  jobId: string;
  /** 0..1; -1 if indeterminate. */
  progress: number;
  message?: string;
}

export type ProgressListener = (event: ProgressEvent) => void;

export interface UpdateState {
  status:
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "downloaded"
    | "uptodate"
    | "error";
  version?: string;
  message?: string;
  /** 0..1 download progress when status === "downloading". */
  progress?: number;
}

export type UpdateListener = (state: UpdateState) => void;

export interface DesktopAPI {
  /** Semver of the host Electron shell. */
  appVersion: string;
  /** Stable platform string ("win32" | "darwin" | "linux"). */
  platform: string;

  dialog: {
    openFile(opts?: OpenFileOptions): Promise<string | null>;
    openFiles(opts?: OpenFileOptions): Promise<string[]>;
    saveFile(opts?: SaveFileOptions): Promise<string | null>;
    openDirectory(opts?: OpenDirectoryOptions): Promise<string | null>;
  };

  fs: {
    /** Returns absolute paths of recently used files for a given key. */
    recent(key: string): Promise<string[]>;
    /**
     * Resolve the on-disk path for a File handed to the renderer via
     * drag-and-drop. Uses Electron's `webUtils.getPathForFile()` under
     * the hood (Electron 32+ — `File.path` is no longer available).
     */
    getPathForFile(file: File): string;
  };

  tools: {
    convert3d(req: Convert3dRequest): Promise<Convert3dResult>;
    unzip(req: UnzipRequest): Promise<UnzipResult>;
    deployScene(req: DeploySceneRequest): Promise<DeploySceneResult>;
  };

  script: {
    read(path: string): Promise<ScriptFileResult>;
    write(path: string, contents: string): Promise<void>;
  };

  updates: {
    check(): Promise<UpdateState>;
    onChange(listener: UpdateListener): () => void;
    quitAndInstall(): Promise<void>;
  };

  /** Subscribe to streaming progress for long-running tool jobs. */
  onProgress(listener: ProgressListener): () => void;
}

declare global {
  interface Window {
    desktop?: DesktopAPI;
  }
}

/**
 * Returns the desktop bridge if running inside Electron, else `null`.
 *
 * The hook subscribes to a `desktop:ready` window event so callers
 * remount automatically once the preload script finishes initializing
 * (the global is normally present by `DOMContentLoaded`, but the event
 * handles HMR reloads of the renderer where the bridge is re-attached
 * a tick later).
 */
export function useDesktopBridge(): DesktopAPI | null {
  const [api, setApi] = useState<DesktopAPI | null>(() =>
    typeof window === "undefined" ? null : window.desktop ?? null,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setApi(window.desktop ?? null);
    sync();
    window.addEventListener("desktop:ready", sync);
    return () => window.removeEventListener("desktop:ready", sync);
  }, []);
  return api;
}

/**
 * Convenience: tells UI components whether they're allowed to perform
 * native disk operations. Used by the Tools panel to decide between
 * full functionality and the "Available in the desktop app" placeholder.
 */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && !!window.desktop;
}
