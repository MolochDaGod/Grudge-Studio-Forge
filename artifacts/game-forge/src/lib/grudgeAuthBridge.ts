/**
 * Grudge ID auth bridge for GameForge.
 *
 * Forge (forge.grudge-studio.com / grudge-studio-forge.vercel.app) is a
 * different origin from the ID hub, so it cannot share the session cookie.
 * It uses the launch-token popup flow against the SSOT auth host:
 *
 *   1. User clicks "Sign in with Grudge ID"
 *   2. Popup opens at id.grudge-studio.com/auth/popup?audience=<forge-origin>
 *   3. User signs in via the unified modal (Discord, Phantom, guest, etc.)
 *   4. Popup posts back { type: "grudge:auth:success", token, player }
 *   5. Forge stores the token + player in the Zustand auth store
 *
 * On OAuth redirects the server appends ?grudge_token=<jwt> — this module
 * also handles extracting and exchanging that on page load.
 *
 * SSOT: id.grudge-studio.com only (never auth.grudge-studio.com).
 * Apex grudge-studio.com still accepted as a postMessage origin for legacy
 * popups that may still be open mid-migration.
 */

import { useAuth, type AuthUser } from "@/store/auth";

/** Production Grudge ID hub — login UI + /api/auth/* (proxied to Railway). */
const GRUDGE_AUTH_HOST = "https://id.grudge-studio.com";
const GRUDGE_API = GRUDGE_AUTH_HOST;

/** Origins allowed to postMessage grudge:auth:* back to Forge. */
const GRUDGE_AUTH_MESSAGE_ORIGINS = new Set([
  GRUDGE_AUTH_HOST,
  "https://grudge-studio.com",
]);

export interface GrudgePlayer {
  id: number;
  username: string;
  grudgeId: string;
  displayName: string | null;
  avatarUrl: string | null;
  gbuxBalance: string;
  role: string;
}

function grudgeToAuthUser(player: GrudgePlayer): AuthUser {
  return {
    id: player.grudgeId,
    name: player.displayName || player.username,
    // No puter identity — Forge treats this as a "signed in" user via Grudge ID.
    // The isPuterSignedIn flag stays false, but the editor is unlocked.
  };
}

const GRUDGE_SESSION_KEY = "grudge.auth.session";

function storeGrudgeSession(player: GrudgePlayer, token: string): void {
  try {
    localStorage.setItem(GRUDGE_SESSION_KEY, JSON.stringify({ player, token, storedAt: Date.now() }));
  } catch { /* quota / private mode */ }
}

function readGrudgeSession(): { player: GrudgePlayer; token: string } | null {
  try {
    const raw = localStorage.getItem(GRUDGE_SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.player?.grudgeId || !data?.token) return null;
    // Tokens expire after 5 min, but we keep the player data for display.
    // On next page load, whoami() will verify if the session is still valid.
    return data;
  } catch {
    return null;
  }
}

export function clearGrudgeSession(): void {
  try { localStorage.removeItem(GRUDGE_SESSION_KEY); } catch { /* */ }
}

/**
 * Bearer JWT for fleet AI (ai.grudge-studio.com) and free-ai grudge-ai proxy.
 * Also accepts standard fleet token keys used across Open / Puter toolkit.
 */
export function getGrudgeBearerToken(): string | null {
  const sess = readGrudgeSession();
  if (sess?.token && sess.token.length > 20) return sess.token;
  try {
    for (const k of [
      "grudge_auth_token",
      "grudge_session_token",
      "grudge.token",
      "sso_token",
    ]) {
      const v = localStorage.getItem(k);
      if (v && v.length > 20) return v;
    }
  } catch {
    /* private mode */
  }
  return null;
}

export function isGrudgeIdSignedIn(): boolean {
  return Boolean(getGrudgeBearerToken() || readGrudgeSession()?.player?.grudgeId);
}

/**
 * Check for a `?grudge_token=` URL parameter (from cross-domain OAuth redirect).
 * If found, exchange it for a session and hydrate the auth store.
 * Returns true if a token was found and successfully exchanged.
 */
export async function checkGrudgeTokenParam(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("grudge_token");
  if (!token) return false;

  // Clean the token from the URL so it doesn't leak in bookmarks/history
  params.delete("grudge_token");
  params.delete("auth");
  params.delete("new");
  const cleanUrl = params.toString()
    ? `${window.location.pathname}?${params.toString()}`
    : window.location.pathname;
  window.history.replaceState({}, "", cleanUrl);

  try {
    const res = await fetch(`${GRUDGE_API}/api/auth/session/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token, audience: window.location.origin }),
    });
    if (!res.ok) return false;
    const player = (await res.json()) as GrudgePlayer;
    storeGrudgeSession(player, token);
    useAuth.getState().setSignedIn(grudgeToAuthUser(player));
    return true;
  } catch {
    return false;
  }
}

/**
 * Silent session check — try to restore a Grudge session from localStorage
 * or by calling /api/auth/me with credentials.
 */
export async function checkGrudgeSession(): Promise<boolean> {
  // First check localStorage for a cached session (also written by Grudge
  // Studio Electron embeds for single-login SSO).
  const cached = readGrudgeSession();
  if (cached) {
    // Prefer Authorization bearer — works cross-origin from forge.grudge-studio.com
    // when Studio injected the JWT (cookies alone may not travel).
    try {
      const res = await fetch(`${GRUDGE_API}/api/auth/me`, {
        credentials: "include",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${cached.token}`,
        },
      });
      if (res.ok) {
        const player = (await res.json()) as GrudgePlayer;
        storeGrudgeSession(player, cached.token);
        useAuth.getState().setSignedIn(grudgeToAuthUser(player));
        return true;
      }
    } catch { /* fall through */ }

    // Offline / API unreachable: still trust a recent Studio-injected session
    // so embedded Forge is not forced through Welcome after a network blip.
    try {
      const raw = localStorage.getItem(GRUDGE_SESSION_KEY);
      const storedAt = raw ? (JSON.parse(raw) as { storedAt?: number }).storedAt : 0;
      const ageMs = Date.now() - (storedAt || 0);
      if (ageMs >= 0 && ageMs < 12 * 60 * 60 * 1000) {
        useAuth.getState().setSignedIn(grudgeToAuthUser(cached.player as GrudgePlayer));
        return true;
      }
    } catch { /* */ }

    clearGrudgeSession();
  }
  return false;
}

/**
 * Open the Grudge auth popup. Must be called from a user-initiated click.
 * Returns the authenticated player on success, throws on cancel/error.
 */
export function signInWithGrudge(): Promise<AuthUser> {
  const audience = window.location.origin;
  const width = 420;
  const height = 640;
  const left = (window.screenX || 0) + (window.outerWidth - width) / 2;
  const top = (window.screenY || 0) + (window.outerHeight - height) / 2;

  return new Promise((resolve, reject) => {
    const popup = window.open(
      `${GRUDGE_AUTH_HOST}/auth/popup?audience=${encodeURIComponent(audience)}`,
      "grudge-auth",
      `width=${width},height=${height},left=${left},top=${top},popup=yes`,
    );
    if (!popup) return reject(new Error("Popup blocked — allow popups for this site."));

    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      if (popup && !popup.closed) popup.close();
      clearInterval(poll);
    };

    const onMessage = (event: MessageEvent) => {
      if (!GRUDGE_AUTH_MESSAGE_ORIGINS.has(event.origin)) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;

      if (data.type === "grudge:auth:success" && data.token && data.player) {
        cleanup();
        const player = data.player as GrudgePlayer;
        storeGrudgeSession(player, data.token);
        const authUser = grudgeToAuthUser(player);
        useAuth.getState().setSignedIn(authUser);
        resolve(authUser);
      } else if (data.type === "grudge:auth:error") {
        cleanup();
        reject(new Error(data.error || "Authentication failed"));
      } else if (data.type === "grudge:auth:cancel") {
        cleanup();
        reject(new Error("Authentication cancelled"));
      }
    };

    const poll = setInterval(() => {
      if (popup.closed) {
        cleanup();
        reject(new Error("Popup closed before authentication finished"));
      }
    }, 500);

    window.addEventListener("message", onMessage);
  });
}
