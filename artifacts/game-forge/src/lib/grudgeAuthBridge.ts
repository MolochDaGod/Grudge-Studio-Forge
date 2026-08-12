/**
 * Grudge ID auth bridge for Forge (fleet SSO SSOT).
 *
 * Identity law:
 *   - **Signed-in for fleet games / Railway bag** = Grudge ID JWT
 *   - **Puter** = User-Pays cloud shell (KV/FS/AI) — never sole “account”
 *   - Host: **id.grudge-studio.com** only (never auth.grudge-studio.com)
 *
 * Login (live contract from grudge-game-bootstrap.js + login page):
 *   - Prefer `/login?redirect_uri=&origin=` (popup OR full redirect)
 *   - Popup postMessage: `grudge-auth:success` (modern) + `grudge:auth:success` (legacy)
 *   - Handoff prefers **sso_token** (session JWT) over **grudge_token** (launch)
 *   - Dual-write all fleet token keys including `grudge.open.token`
 *
 * Do NOT open `/auth/popup` — that path 404s on the production ID gateway.
 */

import { useAuth, type AuthUser } from "@/store/auth";
import { FORGE_ENV } from "@/lib/forgeEnv";

/** Production Grudge ID hub — login UI + /api/auth/* (proxied to Railway). */
export const GRUDGE_AUTH_HOST = FORGE_ENV.grudgeId.replace(/\/$/, "");

/** Origins allowed to postMessage grudge-auth / grudge:auth back to Forge. */
const GRUDGE_AUTH_MESSAGE_ORIGINS = new Set([
  GRUDGE_AUTH_HOST,
  "https://id.grudge-studio.com",
  "https://grudge-studio.com",
  "https://www.grudge-studio.com",
]);

/**
 * Fleet JWT storage keys — write ALL on login, read ANY.
 * Open primary first (shared with gameopen productionSystemsPattern).
 */
export const FLEET_AUTH_TOKEN_KEYS = [
  "grudge.open.token",
  "grudge_auth_token",
  "grudge_session_token",
  "grudge.token",
  "sso_token",
  "grudge_token",
] as const;

const GRUDGE_SESSION_KEY = "grudge.auth.session";
const ACCOUNT_ID_KEY = "grudge_account_id";
const GRUDGE_ID_KEY = "grudge_id";
const USERNAME_KEY = "grudge_username";

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
    grudgeId: player.grudgeId,
    // Puter identity is separate — set only when puter.auth is linked
  };
}

function paramFromSearchOrHash(name: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const url = new URL(window.location.href);
    const q = url.searchParams.get(name);
    if (q) return q;
    if (url.hash && url.hash.length > 1) {
      const hp = new URLSearchParams(url.hash.replace(/^#/, ""));
      return hp.get(name);
    }
  } catch {
    /* */
  }
  return null;
}

function cleanHandoffParamsFromUrl(): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    const keys = [
      "grudge_token",
      "launch_token",
      "sso_token",
      "token",
      "access_token",
      "grudge_id",
      "grudgeId",
      "username",
      "grudge_username",
      "provider",
      "error",
      "auth",
      "new",
      "handoff",
      "signedin",
    ];
    for (const k of keys) url.searchParams.delete(k);
    if (url.hash && url.hash.length > 1) {
      const hp = new URLSearchParams(url.hash.replace(/^#/, ""));
      let changed = false;
      for (const k of keys) {
        if (hp.has(k)) {
          hp.delete(k);
          changed = true;
        }
      }
      if (changed) url.hash = hp.toString() || "";
    }
    const q = url.searchParams.toString();
    window.history.replaceState(
      {},
      "",
      url.pathname + (q ? `?${q}` : "") + (url.hash || ""),
    );
  } catch {
    /* */
  }
}

/** Dual-write JWT to all fleet keys (local + session). */
export function writeFleetToken(token: string | null): void {
  try {
    if (!token) {
      for (const k of FLEET_AUTH_TOKEN_KEYS) {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
      }
      return;
    }
    for (const k of FLEET_AUTH_TOKEN_KEYS) {
      localStorage.setItem(k, token);
      sessionStorage.setItem(k, token);
    }
  } catch {
    /* private mode */
  }
}

export function storeGrudgeSession(player: GrudgePlayer, token: string): void {
  try {
    localStorage.setItem(
      GRUDGE_SESSION_KEY,
      JSON.stringify({ player, token, storedAt: Date.now() }),
    );
  } catch {
    /* quota / private mode */
  }
  writeFleetToken(token);
  try {
    if (player.grudgeId) {
      localStorage.setItem(ACCOUNT_ID_KEY, player.grudgeId);
      localStorage.setItem(GRUDGE_ID_KEY, player.grudgeId);
    }
    if (player.username) {
      localStorage.setItem(USERNAME_KEY, player.username);
    }
  } catch {
    /* */
  }
}

function readGrudgeSession(): { player: GrudgePlayer; token: string; storedAt?: number } | null {
  try {
    const raw = localStorage.getItem(GRUDGE_SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as {
      player?: GrudgePlayer;
      token?: string;
      storedAt?: number;
    };
    if (!data?.player?.grudgeId || !data?.token) return null;
    return { player: data.player, token: data.token, storedAt: data.storedAt };
  } catch {
    return null;
  }
}

export function clearGrudgeSession(): void {
  try {
    localStorage.removeItem(GRUDGE_SESSION_KEY);
  } catch {
    /* */
  }
  writeFleetToken(null);
}

/**
 * Bearer JWT for fleet AI, free-ai Legion proxy, Railway bag/characters.
 * Prefer session JWT (sso / open / auth keys); launch tokens are last resort.
 */
export function getGrudgeBearerToken(): string | null {
  const sess = readGrudgeSession();
  if (sess?.token && sess.token.length > 20 && !isTokenExpired(sess.token)) {
    return sess.token;
  }
  try {
    for (const store of [sessionStorage, localStorage]) {
      for (const k of FLEET_AUTH_TOKEN_KEYS) {
        const v = store.getItem(k);
        if (v && v.length > 20 && !isTokenExpired(v)) return v;
      }
    }
  } catch {
    /* private mode */
  }
  // Fall back to stored session even if exp parse failed
  if (sess?.token && sess.token.length > 20) return sess.token;
  return null;
}

/** True if JWT is missing or past exp (60s skew). Non-JWTs treated as valid. */
export function isTokenExpired(token: string | null, skewSec = 60): boolean {
  if (!token) return true;
  try {
    const part = token.split(".")[1];
    if (!part) return false;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as { exp?: number };
    if (!payload.exp) return false;
    return Date.now() / 1000 >= payload.exp - skewSec;
  } catch {
    return false;
  }
}

export function isGrudgeIdSignedIn(): boolean {
  return Boolean(getGrudgeBearerToken() || readGrudgeSession()?.player?.grudgeId);
}

function playerFromMeJson(me: Record<string, unknown>, fallbackToken?: string): GrudgePlayer | null {
  const grudgeId = String(
    me.grudgeId || me.grudge_id || me.id || me.sub || "",
  );
  if (!grudgeId || grudgeId === "guest") return null;
  return {
    id: typeof me.id === "number" ? me.id : Number(me.numericId) || 0,
    username: String(me.username || me.name || grudgeId),
    grudgeId,
    displayName:
      (me.displayName as string | null) ??
      (me.display_name as string | null) ??
      null,
    avatarUrl:
      (me.avatarUrl as string | null) ?? (me.avatar_url as string | null) ?? null,
    gbuxBalance: String(me.gbuxBalance ?? me.gbux_balance ?? "0"),
    role: String(me.role || "player"),
  };
}

function applySession(player: GrudgePlayer, token: string): AuthUser {
  storeGrudgeSession(player, token);
  const authUser = grudgeToAuthUser(player);
  // Preserve Puter link if already present
  const prev = useAuth.getState().user;
  if (prev?.puter) {
    authUser.puter = prev.puter;
    authUser.id = prev.puter.uuid || player.grudgeId;
  }
  useAuth.getState().setSignedIn(authUser);
  try {
    window.dispatchEvent(
      new CustomEvent("grudge:auth:ready", {
        detail: { token, grudgeId: player.grudgeId, username: player.username },
      }),
    );
  } catch {
    /* */
  }
  return authUser;
}

/** Build canonical ID login URL (popup or redirect). */
export function buildGrudgeLoginUrl(returnUrl?: string, opts?: { app?: string }): string {
  const dest =
    returnUrl ||
    (typeof window !== "undefined"
      ? `${window.location.origin}${window.location.pathname || "/editor"}`
      : `${FORGE_ENV.forgeOrigin}/editor`);
  const origin =
    typeof window !== "undefined" ? window.location.origin : FORGE_ENV.forgeOrigin;
  const q = new URLSearchParams();
  q.set("redirect_uri", dest);
  q.set("redirect", dest);
  q.set("return", dest);
  q.set("return_to", dest);
  q.set("origin", origin);
  q.set("handoff", "1");
  q.set("app", opts?.app || "forge");
  return `${GRUDGE_AUTH_HOST}/login?${q.toString()}`;
}

/**
 * Capture SSO handoff from query + hash.
 * Prefer sso_token (session JWT) over grudge_token (short launch).
 * Returns true if a token was applied / stored.
 */
export async function captureAuthHandoffFromUrl(): Promise<boolean> {
  const sso =
    paramFromSearchOrHash("sso_token") ||
    paramFromSearchOrHash("token") ||
    paramFromSearchOrHash("access_token");
  const launch =
    paramFromSearchOrHash("grudge_token") ||
    paramFromSearchOrHash("launch_token");
  const grudgeId =
    paramFromSearchOrHash("grudge_id") || paramFromSearchOrHash("grudgeId") || "";
  const username =
    paramFromSearchOrHash("username") ||
    paramFromSearchOrHash("grudge_username") ||
    "";

  if (!sso && !launch) return false;

  // Prefer full session JWT
  if (sso && sso.length > 20) {
    const player: GrudgePlayer = {
      id: 0,
      username: username || "player",
      grudgeId: grudgeId || "unknown",
      displayName: username || null,
      avatarUrl: null,
      gbuxBalance: "0",
      role: "player",
    };
    cleanHandoffParamsFromUrl();
    // Verify + enrich via /api/auth/me when possible
    const verified = await verifyTokenAsPlayer(sso);
    if (verified) {
      applySession(verified, sso);
      if (launch) void bridgeLaunchToken(launch).catch(() => undefined);
      return true;
    }
    if (grudgeId && grudgeId !== "unknown") {
      applySession(player, sso);
      return true;
    }
    // Store token even if me failed — free-ai / later me can use it
    writeFleetToken(sso);
    useAuth.getState().setSignedIn({
      id: grudgeId || "grudge-user",
      name: username || "Grudge",
      grudgeId: grudgeId || undefined,
    });
    return true;
  }

  if (launch) {
    cleanHandoffParamsFromUrl();
    const bridged = await bridgeLaunchToken(launch);
    if (bridged) return true;
    // Last resort: treat launch as bearer (some gateways accept it briefly)
    writeFleetToken(launch);
    const verified = await verifyTokenAsPlayer(launch);
    if (verified) {
      applySession(verified, launch);
      return true;
    }
  }

  return false;
}

/** @deprecated use captureAuthHandoffFromUrl — kept for call sites */
export async function checkGrudgeTokenParam(): Promise<boolean> {
  return captureAuthHandoffFromUrl();
}

async function verifyTokenAsPlayer(token: string): Promise<GrudgePlayer | null> {
  const urls = [
    `${GRUDGE_AUTH_HOST}/api/auth/me`,
    `${FORGE_ENV.gameApi.replace(/\/$/, "")}/api/auth/me`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        credentials: /id\.grudge-studio\.com/i.test(url) ? "include" : "omit",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const me = (await res.json()) as Record<string, unknown>;
      const player = playerFromMeJson(me);
      if (player) return player;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Exchange short launch JWT for full session JWT. */
export async function bridgeLaunchToken(launchToken: string): Promise<boolean> {
  if (!launchToken?.trim()) return false;
  const origin =
    typeof window !== "undefined" ? window.location.origin : FORGE_ENV.forgeOrigin;
  const body = JSON.stringify({
    token: launchToken,
    launchToken,
    grudge_token: launchToken,
    audience: origin,
    origin,
  });
  const urls = [
    `${GRUDGE_AUTH_HOST}/api/auth/session/exchange`,
    `${GRUDGE_AUTH_HOST}/api/auth/grudge-bridge`,
    `${FORGE_ENV.gameApi.replace(/\/$/, "")}/api/auth/session/exchange`,
    `${FORGE_ENV.gameApi.replace(/\/$/, "")}/api/auth/grudge-bridge`,
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body,
        credentials: /id\.grudge-studio\.com/i.test(url) ? "include" : "omit",
        signal: AbortSignal.timeout(8000),
      });
      if (r.status === 404 || r.status === 405) continue;
      if (!r.ok) continue;
      const data = (await r.json()) as Record<string, unknown>;
      const t = String(
        data.sessionToken || data.token || data.access_token || data.sso_token || "",
      );
      if (!t) continue;
      const user = (data.user || data.player || data) as Record<string, unknown>;
      let player = playerFromMeJson(user);
      if (!player) player = await verifyTokenAsPlayer(t);
      if (player) {
        applySession(player, t);
        return true;
      }
      writeFleetToken(t);
      return true;
    } catch {
      /* next */
    }
  }
  return false;
}

/**
 * Silent session claim via ID hub cookie (cross-subdomain when available)
 * + local fleet tokens.
 */
export async function checkGrudgeSession(): Promise<boolean> {
  // 1. Cached session + bearer verify
  const cached = readGrudgeSession();
  if (cached?.token) {
    const verified = await verifyTokenAsPlayer(cached.token);
    if (verified) {
      applySession(verified, cached.token);
      return true;
    }
    // Offline / blip: trust recent Studio-injected session (12h)
    try {
      const ageMs = Date.now() - (cached.storedAt || 0);
      if (ageMs >= 0 && ageMs < 12 * 60 * 60 * 1000 && cached.player?.grudgeId) {
        useAuth.getState().setSignedIn(grudgeToAuthUser(cached.player));
        writeFleetToken(cached.token);
        return true;
      }
    } catch {
      /* */
    }
  }

  // 2. Fleet keys without grudge.auth.session envelope
  const fleetTok = getGrudgeBearerToken();
  if (fleetTok && (!cached || cached.token !== fleetTok)) {
    const verified = await verifyTokenAsPlayer(fleetTok);
    if (verified) {
      applySession(verified, fleetTok);
      return true;
    }
  }

  // 3. Silent claim (cookie session on id hub)
  try {
    const r = await fetch(`${GRUDGE_AUTH_HOST}/api/auth/session/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "include",
      body: JSON.stringify({
        audience:
          typeof window !== "undefined" ? window.location.origin : FORGE_ENV.forgeOrigin,
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (r.ok) {
      const data = (await r.json()) as Record<string, unknown>;
      const t = String(
        data.sessionToken || data.token || data.sso_token || data.access_token || "",
      );
      if (t) {
        const user = (data.user || data.player || data) as Record<string, unknown>;
        let player = playerFromMeJson(user);
        if (!player) player = await verifyTokenAsPlayer(t);
        if (player) {
          applySession(player, t);
          return true;
        }
        writeFleetToken(t);
      }
    }
  } catch {
    /* claim optional */
  }

  if (cached && !getGrudgeBearerToken()) {
    clearGrudgeSession();
  }
  return false;
}

/**
 * Open Grudge ID login.
 * 1) Popup to `/login?redirect_uri=…` (not /auth/popup — that 404s)
 * 2) Fallback full-page redirect if popup blocked
 */
export function signInWithGrudge(opts?: {
  /** Prefer full redirect (reliable when popups blocked). */
  forceRedirect?: boolean;
  returnUrl?: string;
}): Promise<AuthUser> {
  const returnUrl =
    opts?.returnUrl ||
    (typeof window !== "undefined"
      ? `${window.location.origin}${window.location.pathname || "/editor"}`
      : `${FORGE_ENV.forgeOrigin}/editor`);
  const loginUrl = buildGrudgeLoginUrl(returnUrl, { app: "forge" });

  if (opts?.forceRedirect) {
    window.location.assign(loginUrl);
    return new Promise(() => {
      /* navigation */
    });
  }

  const width = 480;
  const height = 720;
  const left = (window.screenX || 0) + Math.max(0, (window.outerWidth - width) / 2);
  const top = (window.screenY || 0) + Math.max(0, (window.outerHeight - height) / 2);

  return new Promise((resolve, reject) => {
    let settled = false;
    const popup = window.open(
      loginUrl,
      "grudge_id_login",
      `popup=yes,width=${width},height=${height},left=${left},top=${top}`,
    );

    if (!popup) {
      // Popup blocked → full redirect handoff
      try {
        sessionStorage.setItem("grudge_auth_return", returnUrl);
      } catch {
        /* */
      }
      window.location.assign(loginUrl);
      return;
    }

    // Tell login page our origin (some builds wait for grudge-auth:init)
    try {
      popup.postMessage(
        { type: "grudge-auth:init", origin: window.location.origin },
        GRUDGE_AUTH_HOST,
      );
    } catch {
      /* */
    }

    const finish = (user: AuthUser) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(user);
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const onMessage = (event: MessageEvent) => {
      if (!GRUDGE_AUTH_MESSAGE_ORIGINS.has(event.origin) && event.origin !== window.location.origin) {
        // Some ID builds post with * after validation — still require token shape
        if (!event.data || typeof event.data !== "object") return;
      }
      const data = event.data as Record<string, unknown> | null;
      if (!data || typeof data !== "object") return;
      const type = String(data.type || "");

      // Modern + legacy success shapes
      const isSuccess =
        type === "grudge-auth:success" ||
        type === "grudge:auth:success" ||
        type === "GRUDGE_AUTH";

      if (!isSuccess) {
        if (type === "grudge:auth:error" || type === "grudge-auth:error") {
          fail(new Error(String(data.error || "Authentication failed")));
        } else if (type === "grudge:auth:cancel" || type === "grudge-auth:cancel") {
          fail(new Error("Authentication cancelled"));
        }
        return;
      }

      const token = String(
        data.sessionToken || data.token || data.sso_token || data.access_token || "",
      );
      if (!token || token.length < 20) {
        fail(new Error("Grudge ID returned no session token"));
        return;
      }

      const rawPlayer = (data.player || data.user || {}) as Record<string, unknown>;
      let player = playerFromMeJson(rawPlayer);
      if (!player) {
        const gid = String(
          rawPlayer.grudgeId ||
            rawPlayer.grudge_id ||
            data.grudgeId ||
            data.grudge_id ||
            "",
        );
        if (gid) {
          player = {
            id: 0,
            username: String(rawPlayer.username || data.username || gid),
            grudgeId: gid,
            displayName:
              (rawPlayer.displayName as string) ||
              (rawPlayer.display_name as string) ||
              null,
            avatarUrl: null,
            gbuxBalance: "0",
            role: "player",
          };
        }
      }

      void (async () => {
        if (!player) {
          player = await verifyTokenAsPlayer(token);
        }
        if (!player) {
          writeFleetToken(token);
          const authUser: AuthUser = {
            id: "grudge-user",
            name: String(data.username || "Grudge"),
          };
          useAuth.getState().setSignedIn(authUser);
          finish(authUser);
          return;
        }
        finish(applySession(player, token));
        // Optional: soft-link Puter UUID when already signed in on Puter plane
        void tryLinkPuterToGrudge(token).catch(() => undefined);
      })();
    };

    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      if (popup && !popup.closed) {
        try {
          popup.close();
        } catch {
          /* */
        }
      }
      clearInterval(poll);
    };

    const poll = setInterval(() => {
      if (popup.closed) {
        // May have completed via redirect handoff to opener already
        if (!settled) {
          // Give a beat for last postMessage
          setTimeout(() => {
            if (settled) return;
            const tok = getGrudgeBearerToken();
            if (tok) {
              void verifyTokenAsPlayer(tok).then((p) => {
                if (p) finish(applySession(p, tok));
                else fail(new Error("Popup closed before authentication finished"));
              });
            } else {
              fail(new Error("Popup closed before authentication finished"));
            }
          }, 400);
          clearInterval(poll);
        }
      }
    }, 500);

    window.addEventListener("message", onMessage);
  });
}

/** Full-page redirect login (most reliable). */
export function signInWithGrudgeRedirect(returnUrl?: string): void {
  const dest =
    returnUrl ||
    `${window.location.origin}${window.location.pathname || "/editor"}`;
  try {
    sessionStorage.setItem("grudge_auth_return", dest);
  } catch {
    /* */
  }
  window.location.assign(buildGrudgeLoginUrl(dest, { app: "forge" }));
}

/**
 * After Puter sign-in, optionally link Puter UUID → Grudge account
 * (POST /api/auth/puter). Never treats Puter as bag SSOT.
 */
export async function tryLinkPuterToGrudge(
  grudgeToken?: string | null,
  puterUuid?: string | null,
): Promise<boolean> {
  const token = grudgeToken || getGrudgeBearerToken();
  if (!token || !puterUuid) return false;
  try {
    const r = await fetch(`${GRUDGE_AUTH_HOST}/api/auth/puter`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      credentials: "include",
      body: JSON.stringify({
        puterUuid,
        puter_uuid: puterUuid,
        uuid: puterUuid,
      }),
      signal: AbortSignal.timeout(8000),
    });
    return r.ok;
  } catch {
    return false;
  }
}
