/**
 * Lazy loader + thin typed wrapper for the Puter v2 browser SDK.
 *
 * The SDK is fetched from `js.puter.com/v2/` on first use rather than at
 * app boot — it's ~250 KB and only matters for users who actually click
 * "Sign in with Grudge Studio". Once loaded it attaches to `window.puter`.
 *
 * We deliberately surface only the small slice of the SDK the editor
 * uses: auth (sign in / sign out / token / user) and `fs` (file read,
 * file picker). Everything else stays accessible via `getPuter()` for
 * one-off callers without polluting this module's public surface.
 */

/** Subset of the SDK's surface that the editor actually exercises. */
export interface PuterSdk {
  auth: {
    isSignedIn(): boolean | Promise<boolean>;
    signIn(): Promise<unknown>;
    signOut(): Promise<unknown> | void;
    getUser(): Promise<{
      uuid?: string;
      username?: string;
      email?: string;
      email_confirmed?: boolean;
    }>;
    /** Returns the bearer token for the currently signed-in user, or
     *  null if no user is signed in. Some SDK builds expose this as a
     *  property rather than a function — we tolerate both. */
    getAccessToken?(): string | Promise<string>;
    accessToken?: string;
    token?: string;
  };
  fs: {
    read(path: string): Promise<Blob>;
    write(
      path: string,
      data: Blob | string | ArrayBuffer,
      opts?: { overwrite?: boolean; createMissingParents?: boolean },
    ): Promise<unknown>;
    mkdir(
      path: string,
      opts?: { createMissingParents?: boolean; overwrite?: boolean },
    ): Promise<unknown>;
    readdir(path: string): Promise<Array<{ name: string; is_dir: boolean }>>;
  };
  ui?: {
    showOpenFilePicker?: (
      opts?: { multiple?: boolean },
    ) => Promise<{ name: string; read(): Promise<Blob> } | null>;
  };
  /** Static-site hosting. Creates a `<subdomain>.puter.site` that serves
   *  files from `dirPath` in the user's Puter cloud. Older SDK builds may
   *  not expose this — callers should feature-detect before invoking. */
  hosting?: {
    create(
      subdomain: string,
      dirPath: string,
    ): Promise<{ subdomain: string; url?: string }>;
  };
}

declare global {
  interface Window {
    puter?: PuterSdk;
  }
}

let loadPromise: Promise<PuterSdk> | null = null;

/** Lazy-load the Puter SDK. Subsequent calls reuse the same promise so
 *  we never inject the script twice. Resolves with `window.puter`. */
export function loadPuterSdk(origin = "https://js.puter.com"): Promise<PuterSdk> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Puter SDK is browser-only"));
  }
  if (window.puter) return Promise.resolve(window.puter);
  if (loadPromise) return loadPromise;

  const PUTER_LOAD_MS = 8_000;
  loadPromise = new Promise<PuterSdk>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${origin.replace(/\/$/, "")}/v2/`;
    script.async = true;
    // NOTE: do NOT set `crossOrigin` here. Puter's CDN does not return
    // `Access-Control-Allow-Origin`, so any value (including "anonymous")
    // forces a CORS preflight that fails and the script never loads.
    // Plain `<script>` tags execute fine cross-origin without CORS — we
    // just lose the ability to read window.onerror details, which we
    // don't need (the SDK exposes its own `window.puter` global).
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        loadPromise = null;
        reject(err);
      } else if (window.puter) {
        resolve(window.puter);
      } else {
        loadPromise = null;
        reject(new Error("Puter SDK loaded but window.puter is missing"));
      }
    };
    const timer = window.setTimeout(() => {
      // Hang forever if Puter CDN is blocked/slow → editor stuck at auth idle.
      finish(new Error("Puter SDK load timeout"));
    }, PUTER_LOAD_MS);
    script.onload = () => finish();
    script.onerror = () => finish(new Error("Failed to load Puter SDK"));
    document.head.appendChild(script);
  });
  return loadPromise;
}

/** Resolve the Puter access token across SDK builds. Older releases
 *  exposed `puter.auth.token`; newer ones use `getAccessToken()` (sync
 *  or async). We try them in priority order and normalise to a string. */
export async function readAccessToken(sdk: PuterSdk): Promise<string | null> {
  const auth = sdk.auth;
  if (typeof auth.getAccessToken === "function") {
    const v = await auth.getAccessToken();
    if (typeof v === "string" && v.length > 0) return v;
  }
  if (typeof auth.accessToken === "string" && auth.accessToken.length > 0) {
    return auth.accessToken;
  }
  if (typeof auth.token === "string" && auth.token.length > 0) {
    return auth.token;
  }
  return null;
}

/** Get the SDK if it's already loaded; null otherwise. Useful for
 *  feature gates that should never trigger a load on the cold path. */
export function getPuter(): PuterSdk | null {
  return typeof window !== "undefined" ? window.puter ?? null : null;
}
