import {
  getAuthConfig,
  syncPuterUser,
} from "@workspace/api-client-react";
import { useAuth } from "@/store/auth";
import { getPuter, loadPuterSdk, readAccessToken } from "@/lib/puterSdk";

/**
 * Boot the auth store. Called once from App.tsx on mount.
 *
 * Steps:
 *   1. Pull `/auth/config` so the store knows the Puter origin + flags
 *      and can render the right buttons.
 *   2. If the Puter SDK is *already* loaded (because the user signed in
 *      previously, the SDK persisted their session, and the script tag
 *      from a previous load is still cached), check whether the SDK
 *      reports a signed-in user. If so, sync once with our server.
 *
 * We deliberately do NOT auto-load the SDK at boot for guest visitors —
 * Puter Auth is opt-in, and a 250 KB script download for someone who
 * just wants to play around in the editor is wasteful. The "Sign in"
 * button in the toolbar lazy-loads the SDK on click.
 *
 * Errors are non-fatal — the user lands in `anon` mode and can retry
 * via the toolbar.
 */
export async function bootstrapAuth(): Promise<void> {
  const auth = useAuth.getState();
  auth.setLoading();
  try {
    const config = await getAuthConfig().catch(() => null);
    if (config) {
      auth.setConfig(config);
    } else {
      auth.setConfig({
        puterSiteOrigin: "https://puter.com",
        puterBasePath: "/grudge-gameforge",
        enablePuterCloud: false,
        grudgeAuthUrl: null,
      });
    }

    // Resume a prior Puter session if one exists. We *do* lazy-load the
    // SDK here (it lives in localStorage as the access-token bearer), but
    // we never open the popup — we only sync if `isSignedIn()` is true.
    // Guests pay one cheap script download (cached after first visit) but
    // don't see any UI flash. Anything that throws during the probe falls
    // back to anon mode silently.
    let sdk = getPuter();
    if (!sdk) {
      try {
        sdk = await loadPuterSdk("https://js.puter.com");
      } catch {
        auth.setUser(null);
        return;
      }
    }
    const signedIn = await Promise.resolve(sdk.auth.isSignedIn()).catch(
      () => false,
    );
    if (!signedIn) {
      auth.setUser(null);
      return;
    }
    const token = await readAccessToken(sdk);
    if (!token) {
      auth.setUser(null);
      return;
    }
    const result = await syncPuterUser({ puterAccessToken: token });
    auth.setUser(result.user);
    // Visible breadcrumb in the editor console so the user can tell their
    // prior Puter session was restored on this page load (no popup needed).
    // Lazy-import the editor store to avoid a circular dependency.
    try {
      const { useEditor } = await import("@/store/editor");
      useEditor
        .getState()
        .pushLog(
          "info",
          `Resumed Puter session as ${result.user.username ?? result.user.userId}`,
        );
    } catch {
      /* console wiring failure is harmless */
    }
  } catch (err) {
    auth.setError((err as Error).message ?? "Auth bootstrap failed");
  }
}

/**
 * Run the full Puter sign-in handshake:
 *   1. Lazy-load the SDK (no-op if already loaded).
 *   2. Trigger the popup-based `puter.auth.signIn()` if not already signed in.
 *   3. Read the access token from the SDK.
 *   4. Mirror the user into our shared `users` table via `/auth/puter/sync`
 *      and pull back the resolved view (Grudge ID, etc.).
 *   5. Hydrate the auth store with the returned user.
 *
 * Throws on the underlying error so the caller (UserMenu) can show a
 * toast — the auth store also captures the message via `setError`.
 */
export async function signInWithPuter(): Promise<void> {
  const auth = useAuth.getState();
  auth.setLoading();
  try {
    // The Puter SDK is hosted on `js.puter.com` regardless of which
    // `puter.com` site origin we pass in. Normalise so a misconfigured
    // `PUTER_SITE_ORIGIN` (e.g. pointing at the dashboard) doesn't
    // break the loader.
    const sdk = await loadPuterSdk("https://js.puter.com");

    // Skip signIn() if the user is already signed in to Puter from a
    // previous session — saves a popup.
    const already = await Promise.resolve(sdk.auth.isSignedIn()).catch(
      () => false,
    );
    if (!already) {
      await sdk.auth.signIn();
    }

    const token = await readAccessToken(sdk);
    if (!token) {
      throw new Error("Puter sign-in completed but no access token was returned.");
    }

    const result = await syncPuterUser({ puterAccessToken: token });
    auth.setUser(result.user);
  } catch (err) {
    const message = (err as Error).message ?? "Sign-in failed";
    auth.setError(message);
    throw err;
  }
}

/**
 * Sign out: ask the Puter SDK to drop the user's token, then clear the
 * local store. Forge has no server-side session to tear down.
 */
export async function signOut(): Promise<void> {
  const auth = useAuth.getState();
  auth.setLoading();
  try {
    const sdk = getPuter();
    if (sdk?.auth.signOut) await sdk.auth.signOut();
  } catch {
    // Best-effort. The user can still close the tab to fully reset.
  }
  auth.setUser(null);
}
