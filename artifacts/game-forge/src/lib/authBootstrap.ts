import {
  exchangePuterToken,
  getAuthConfig,
  getCurrentUser,
  logoutCurrentUser,
} from "@workspace/api-client-react";
import { useAuth } from "@/store/auth";
import { loadPuterSdk, readAccessToken } from "@/lib/puterSdk";

/**
 * Boot the auth store. Called once from App.tsx on mount.
 *
 * Steps:
 *   1. Pull `/auth/config` so the store knows the Puter origin + flags
 *      and can render the right buttons.
 *   2. Pull `/auth/me` to rehydrate the current session from the
 *      HttpOnly cookie (if any).
 *
 * Errors are non-fatal — a failure here drops the user into anonymous
 * mode and surfaces the error so the UI can show a "Retry sign-in"
 * affordance.
 */
export async function bootstrapAuth(): Promise<void> {
  const auth = useAuth.getState();
  auth.setLoading();
  try {
    // Run both in parallel — neither depends on the other.
    const [configResult, meResult] = await Promise.allSettled([
      getAuthConfig(),
      getCurrentUser(),
    ]);

    if (configResult.status === "fulfilled") {
      auth.setConfig(configResult.value);
    } else {
      // We can still operate without config — assume sane defaults
      // (Puter origin = puter.com, cloud features off).
      auth.setConfig({
        puterSiteOrigin: "https://puter.com",
        puterBasePath: "/grudge-gameforge",
        enablePuterCloud: false,
        grudgeAuthUrl: null,
      });
    }

    if (meResult.status === "fulfilled") {
      auth.setUser(meResult.value.user ?? null);
    } else {
      auth.setUser(null);
    }
  } catch (err) {
    auth.setError((err as Error).message ?? "Auth bootstrap failed");
  }
}

/**
 * Run the full Puter sign-in handshake:
 *   1. Lazy-load the SDK (no-op if already loaded).
 *   2. Trigger the popup-based `puter.auth.signIn()`.
 *   3. Read the access token from the SDK.
 *   4. Exchange it server-side for a Grudge session cookie.
 *   5. Hydrate the auth store with the returned user.
 *
 * Throws on the underlying error so the caller (UserMenu) can show a
 * toast — the auth store also captures the message via `setError`.
 */
export async function signInWithPuter(): Promise<void> {
  const auth = useAuth.getState();
  auth.setLoading();
  try {
    const origin = auth.config?.puterSiteOrigin ?? "https://js.puter.com";
    // The SDK is hosted on `js.puter.com`, not on the main `puter.com`
    // origin. We accept either in config and normalise to js.puter.com.
    const sdkOrigin = origin.includes("js.puter.com")
      ? origin
      : "https://js.puter.com";

    const sdk = await loadPuterSdk(sdkOrigin);

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

    const result = await exchangePuterToken({ puterAccessToken: token });
    auth.setUser(result.user ?? null);
  } catch (err) {
    const message = (err as Error).message ?? "Sign-in failed";
    auth.setError(message);
    throw err;
  }
}

export async function signOut(): Promise<void> {
  const auth = useAuth.getState();
  auth.setLoading();
  try {
    await logoutCurrentUser();
  } catch {
    // Even if the server call fails, drop the local session — the
    // worst case is a stale cookie that the next /auth/me call will
    // either revalidate or clear via 401.
  }
  // Best-effort sign-out from Puter as well, so the next sign-in
  // doesn't silently re-auth as the same user. We swallow errors
  // because the SDK might not be loaded.
  try {
    const sdk = (await import("@/lib/puterSdk")).getPuter();
    if (sdk?.auth.signOut) await sdk.auth.signOut();
  } catch {
    // Ignored
  }
  auth.setUser(null);
}
