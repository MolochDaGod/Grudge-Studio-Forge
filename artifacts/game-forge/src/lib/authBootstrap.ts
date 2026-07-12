/**
 * Real Puter Auth.
 *
 * Boot path (no popup):
 *   - `bootstrapAuth()` lazy-loads the SDK and calls `isSignedIn()` +
 *     `getUser()`. If a session exists, hydrate the store with the real
 *     Puter identity (uuid, username, optional email, isTemp). If not,
 *     leave the user in `anon` so the Welcome modal can render.
 *   - Falls back to the local guest record (if any) on SDK load failure
 *     so users who clicked "Continue without signing in" stay signed in
 *     across reloads even when the Puter CDN is blocked.
 *
 * Active flows (require a real user click — popups are blocked otherwise):
 *   - `signInWithPuter()` calls `puter.auth.signIn({attempt_temp_user_creation:true})`.
 *   - `continueAsGuest()` opts out — store goes to `guest`, persisted locally.
 *   - `signOut()` calls `puter.auth.signOut()` then resets the store.
 */
import { useAuth, type AuthUser, type PuterIdentity } from "@/store/auth";
import { loadPuterSdk, getPuter, type PuterSdk } from "@/lib/puterSdk";
import { checkGrudgeTokenParam, checkGrudgeSession, clearGrudgeSession } from "@/lib/grudgeAuthBridge";

const GUEST_KEY = "grudge.auth.guestUser";

interface StoredGuest {
  id: string;
  name: string;
}

function readStoredGuest(): StoredGuest | null {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<StoredGuest>;
    if (typeof p.id !== "string" || typeof p.name !== "string") return null;
    return { id: p.id, name: p.name };
  } catch {
    return null;
  }
}

function writeStoredGuest(g: StoredGuest | null): void {
  try {
    if (g) localStorage.setItem(GUEST_KEY, JSON.stringify(g));
    else localStorage.removeItem(GUEST_KEY);
  } catch {
    /* private mode / quota — non-fatal */
  }
}

function makeGuestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `guest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

function toAuthUser(raw: {
  uuid?: string;
  username?: string;
  email?: string;
  is_temp?: boolean;
  email_confirmed?: boolean;
}): AuthUser | null {
  if (!raw.uuid || !raw.username) return null;
  const puter: PuterIdentity = {
    uuid: raw.uuid,
    username: raw.username,
    email: typeof raw.email === "string" && raw.email.length > 0 ? raw.email : null,
    // Some SDK builds report `is_temp`, some leave it undefined when claimed.
    // Treat missing as "not temp" so we don't show a stale claim chip.
    isTemp: raw.is_temp === true,
  };
  return { id: puter.uuid, name: puter.username, puter };
}

async function readPuterSession(sdk: PuterSdk): Promise<AuthUser | null> {
  let signedIn = false;
  try {
    signedIn = await Promise.resolve(sdk.auth.isSignedIn());
  } catch {
    return null;
  }
  if (!signedIn) return null;
  try {
    const u = await sdk.auth.getUser();
    return toAuthUser((u ?? {}) as Parameters<typeof toAuthUser>[0]);
  } catch {
    return null;
  }
}

/**
 * Boot the auth store. Called once from App.tsx on mount.
 *
 * Pure read path — never opens a popup. If the user already has a Puter
 * session it's restored; otherwise we check for a persisted guest choice,
 * and otherwise leave the store at `anon` so the Welcome modal renders.
 */
export async function bootstrapAuth(): Promise<void> {
  // 1. Check for a ?grudge_token= URL param (cross-domain OAuth redirect)
  //    — used by Grudge Studio (dev tool) module embeds for single login.
  if (await checkGrudgeTokenParam()) return;

  // 2. Check for an existing Grudge ID session in localStorage
  //    (may have been injected by Studio webview SSO before this ran)
  if (await checkGrudgeSession()) return;

  // 3. Try the Puter SDK. We tolerate CDN load failures (corp networks
  // that block puter.com) by falling through to the guest path.
  let sdk: PuterSdk | null = null;
  try {
    sdk = await loadPuterSdk();
  } catch {
    sdk = null;
  }

  if (sdk) {
    const user = await readPuterSession(sdk);
    if (user) {
      useAuth.getState().setSignedIn(user);
      return;
    }
  }

  const guest = readStoredGuest();
  if (guest) {
    useAuth.getState().setGuest({ id: guest.id, name: guest.name });
    return;
  }

  useAuth.getState().reset();
}

/**
 * Studio (Electron) injects Puter + Grudge tokens into the webview after
 * load and dispatches `grudge:sso-hydrate`. Re-apply that identity without
 * a full page reload so the user is not forced through Welcome again.
 */
export function installStudioSsoHydrateListener(): () => void {
  if (typeof window === "undefined") return () => {};

  const onHydrate = (ev: Event) => {
    const detail = (ev as CustomEvent).detail as
      | {
          player?: {
            id?: number;
            username?: string;
            grudgeId?: string;
            displayName?: string | null;
          } | null;
          token?: string | null;
          puterToken?: string | null;
          puterUser?: { uuid?: string; username?: string; email?: string } | null;
        }
      | undefined;
    if (!detail) return;

    // Prefer Grudge player identity from Studio SSO
    if (detail.player?.grudgeId && detail.token) {
      try {
        localStorage.setItem(
          "grudge.auth.session",
          JSON.stringify({
            player: {
              id: detail.player.id ?? 0,
              username: detail.player.username ?? "player",
              grudgeId: detail.player.grudgeId,
              displayName: detail.player.displayName ?? detail.player.username ?? null,
              avatarUrl: null,
              gbuxBalance: "0",
              role: "player",
            },
            token: detail.token,
            storedAt: Date.now(),
          }),
        );
      } catch { /* */ }

      const puter =
        detail.puterUser?.uuid && detail.puterUser?.username
          ? {
              uuid: detail.puterUser.uuid,
              username: detail.puterUser.username,
              email: detail.puterUser.email ?? null,
              isTemp: false,
            }
          : detail.player.grudgeId
            ? {
                // Synthetic puter-shaped id so isPuterSignedIn gates work for
                // Cloud Save when Studio already holds the real Puter token.
                uuid: detail.puterUser?.uuid ?? detail.player.grudgeId,
                username: detail.player.username ?? "player",
                email: detail.puterUser?.email ?? null,
                isTemp: false,
              }
            : undefined;

      useAuth.getState().setSignedIn({
        id: puter?.uuid ?? detail.player.grudgeId,
        name: detail.player.displayName || detail.player.username || "Player",
        puter,
      });
      return;
    }

    // Puter-only hydrate (no Grudge player row yet)
    if (detail.puterUser?.uuid && detail.puterUser?.username) {
      useAuth.getState().setSignedIn({
        id: detail.puterUser.uuid,
        name: detail.puterUser.username,
        puter: {
          uuid: detail.puterUser.uuid,
          username: detail.puterUser.username,
          email: detail.puterUser.email ?? null,
          isTemp: false,
        },
      });
    }
  };

  window.addEventListener("grudge:sso-hydrate", onHydrate);
  return () => window.removeEventListener("grudge:sso-hydrate", onHydrate);
}

/**
 * Sign in with Puter. MUST be called from a user-initiated click — Puter's
 * popup is blocked otherwise. Returns the resolved user, or throws on
 * failure / cancel.
 */
export async function signInWithPuter(): Promise<AuthUser> {
  const sdk = await loadPuterSdk();
  // attempt_temp_user_creation lets first-time visitors sign in without
  // leaving the page. They get an `is_temp` Puter account they can claim
  // later via the "Claim your account" chip.
  await (sdk.auth.signIn as (opts?: { attempt_temp_user_creation?: boolean }) => Promise<unknown>)(
    { attempt_temp_user_creation: true },
  );
  const user = await readPuterSession(sdk);
  if (!user) {
    throw new Error("Puter sign-in completed but no user was returned");
  }
  // Guest record (if any) is no longer the source of truth — clear it so
  // a future sign-out doesn't unexpectedly revive a stale guest name.
  writeStoredGuest(null);
  useAuth.getState().setSignedIn(user);
  return user;
}

/**
 * Continue without signing in. Stores a local guest identity so the user
 * keeps the same display name across reloads, but does NOT touch Puter.
 */
export function continueAsGuest(name?: string): AuthUser {
  const trimmed = (name ?? "").trim();
  const finalName =
    trimmed.length > 0
      ? trimmed.slice(0, 32)
      : `Player-${Math.floor(Math.random() * 9000 + 1000)}`;
  const stored = readStoredGuest();
  const id = stored?.id ?? makeGuestId();
  const user: AuthUser = { id, name: finalName };
  writeStoredGuest({ id, name: finalName });
  useAuth.getState().setGuest(user);
  return user;
}

/** Update the display name of the current guest. No-op when signed in
 *  via Puter — that name comes from `puter.auth.getUser()`. */
export function renameGuest(name: string): void {
  const cur = useAuth.getState().user;
  if (!cur || cur.puter) return;
  const trimmed = name.trim().slice(0, 32);
  if (!trimmed) return;
  const updated: AuthUser = { ...cur, name: trimmed };
  writeStoredGuest({ id: updated.id, name: updated.name });
  useAuth.getState().setGuest(updated);
}

/**
 * Sign out. Tries to sign out of Puter (no-op when not loaded), clears
 * the local guest record, and resets the store to `anon`.
 */
export async function signOut(): Promise<void> {
  const sdk = getPuter();
  if (sdk) {
    try {
      await Promise.resolve(sdk.auth.signOut());
    } catch {
      /* SDK error during sign-out shouldn't block the local reset */
    }
  }
  writeStoredGuest(null);
  clearGrudgeSession();
  useAuth.getState().reset();
}
