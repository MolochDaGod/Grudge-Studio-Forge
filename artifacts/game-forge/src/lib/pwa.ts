type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<(installable: boolean) => void>();

function notify(installable: boolean) {
  for (const cb of listeners) {
    try {
      cb(installable);
    } catch {
      /* swallow listener errors */
    }
  }
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

export function onInstallableChange(cb: (installable: boolean) => void): () => void {
  listeners.add(cb);
  cb(deferredPrompt !== null);
  return () => {
    listeners.delete(cb);
  };
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferredPrompt) return "unavailable";
  const evt = deferredPrompt;
  deferredPrompt = null;
  notify(false);
  try {
    await evt.prompt();
    const choice = await evt.userChoice;
    return choice.outcome;
  } catch {
    return "dismissed";
  }
}

export function registerPwa() {
  if (typeof window === "undefined") return;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify(true);
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notify(false);
  });

  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => {
          /* service worker registration is best-effort */
        });
    });
  }
}
