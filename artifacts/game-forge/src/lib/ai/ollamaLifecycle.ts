/**
 * Ollama reachability + optional auto-start helpers.
 * Browser cannot spawn processes; desktop may expose startOllama via preload.
 */
import { loadAiUserSettings } from "./aiUserSettings";

export type OllamaEnsureResult = {
  ok: boolean;
  /** User-facing status. */
  message: string;
  /** Suggested shell command when manual start is needed. */
  command?: string;
  /** How we resolved. */
  via: "already" | "desktop" | "poll" | "manual";
};

type DesktopOllama = {
  startOllama?: () => Promise<{ ok: boolean; message?: string }>;
};

function desktopApi(): DesktopOllama | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { desktop?: DesktopOllama };
  return w.desktop ?? null;
}

export function getOllamaBaseUrl(): string {
  return loadAiUserSettings().ollamaBaseUrl || "http://localhost:11434";
}

/** Bust isOllamaAvailable short cache after start attempts. */
export function invalidateOllamaCache(): void {
  try {
    // Lazy require avoids circular import with ollamaProvider → aiUserSettings
    void import("./providers/ollamaProvider").then((m) => {
      m.clearOllamaAvailabilityCache();
    });
  } catch {
    /* ignore */
  }
}

export async function probeOllama(baseUrl?: string): Promise<boolean> {
  const base = (baseUrl || getOllamaBaseUrl()).replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * If Ollama is down and auto-start is enabled, try desktop IPC then poll.
 * Never blocks more than ~timeoutMs.
 */
export async function ensureOllamaRunning(opts?: {
  forceAttempt?: boolean;
  timeoutMs?: number;
}): Promise<OllamaEnsureResult> {
  const settings = loadAiUserSettings();
  const base = settings.ollamaBaseUrl;
  const shouldTry =
    opts?.forceAttempt || settings.autoStartOllama || settings.forceOffline;

  invalidateOllamaCache();

  if (await probeOllama(base)) {
    invalidateOllamaCache();
    return {
      ok: true,
      message: `Ollama ready at ${base}`,
      via: "already",
    };
  }

  if (!shouldTry) {
    return {
      ok: false,
      message: "Ollama not running. Enable Auto-start in ⚙ Routing or run ollama serve.",
      command: "ollama serve",
      via: "manual",
    };
  }

  const desk = desktopApi();
  if (desk?.startOllama) {
    try {
      const r = await desk.startOllama();
      if (r.ok) {
        const deadline = Date.now() + (opts?.timeoutMs ?? 12_000);
        while (Date.now() < deadline) {
          if (await probeOllama(base)) {
            return {
              ok: true,
              message: r.message || "Ollama started (desktop)",
              via: "desktop",
            };
          }
          await new Promise((res) => setTimeout(res, 500));
        }
      }
    } catch {
      /* fall through to manual */
    }
  }

  // Poll briefly in case user started Ollama in another terminal
  const deadline = Date.now() + Math.min(opts?.timeoutMs ?? 4000, 8000);
  while (Date.now() < deadline) {
    if (await probeOllama(base)) {
      return { ok: true, message: `Ollama ready at ${base}`, via: "poll" };
    }
    await new Promise((res) => setTimeout(res, 400));
  }

  return {
    ok: false,
    message:
      "Could not start Ollama from the browser. Install from ollama.com, then run the command below (or use Forge Desktop).",
    command: "ollama serve",
    via: "manual",
  };
}
