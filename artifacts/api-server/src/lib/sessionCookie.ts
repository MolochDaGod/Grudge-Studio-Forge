import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import type { Request, Response } from "express";

/**
 * Session cookie helpers for Grudge Studio Puter Auth.
 *
 * The cookie carries a signed reference to a row in the existing shared
 * `sessions` table (which is also written to by the upstream Grudge auth
 * service — see `GRUDGE_AUTH_URL`). We deliberately do not store the user
 * profile in the cookie itself: revocation must be a single DELETE.
 *
 * Cookie value format:  `<session_id>.<hex_signature>`
 *   - `session_id` is a UUID we generate when the session row is inserted
 *   - signature = HMAC-SHA256(JWT_SECRET, session_id), hex-encoded
 *
 * The signature is belt-and-braces: even a malicious cookie carrying a
 * valid existing `session_id` would still need a matching HMAC to be
 * accepted, so cookie theft via a different domain (or copy/paste) cannot
 * be replayed against this server unless `JWT_SECRET` is also leaked.
 */

const COOKIE_NAME = "gforge_session";
/** 30 days — matches the existing `sessions.expires_at` window observed
 *  in the shared DB (`created_at` + 30d). */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function getSecret(): string {
  // We accept either JWT_SECRET (preferred — used by the wider Grudge
  // ecosystem) or SESSION_SECRET as a fallback so this server still runs
  // in dev environments that only provisioned the Replit defaults.
  const secret = process.env.JWT_SECRET ?? process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "JWT_SECRET (or SESSION_SECRET) must be set for cookie signing.",
    );
  }
  return secret;
}

function sign(sessionId: string): string {
  return createHmac("sha256", getSecret()).update(sessionId).digest("hex");
}

/** Verify a candidate signature in constant time. Returns the underlying
 *  session id when valid, or null when malformed/forged. */
export function parseSessionCookie(raw: string | undefined): string | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot < 1 || dot === raw.length - 1) return null;
  const sessionId = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  let expected: string;
  try {
    expected = sign(sessionId);
  } catch {
    return null;
  }
  // Reject obviously-wrong lengths up front so timingSafeEqual doesn't
  // throw on length mismatch (which would itself leak timing).
  if (sig.length !== expected.length) return null;
  try {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return sessionId;
}

/** Encode a session id + signature for transport in the cookie. */
export function buildCookieValue(sessionId: string): string {
  return `${sessionId}.${sign(sessionId)}`;
}

/** Cryptographically-strong UUID-shaped id used for the `sessions.session_id`
 *  column. We use the same shape (`xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`)
 *  as the upstream service's existing rows so admin tooling that scans the
 *  table doesn't trip over a foreign id format. */
export function newSessionId(): string {
  const b = randomBytes(16);
  // Set version (4) and variant (10xx) bits per RFC 4122.
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Mint a stable per-user `grudge_id` for the `sessions` table when the
 * user does not already have a row in the shared `grudge_accounts`
 * registry. Format mirrors the existing rows: `GRUDGE-<13digits>-<HEX>`.
 *
 * IMPORTANT: this MUST be deterministic for a given `seed`. We previously
 * mixed `Date.now()` into the suffix, which meant every call returned a
 * different id — so the value embedded in `sessions.grudge_id` (set at
 * sign-in) didn't match what `loadUserView` later returned (computed on
 * every read), and `forge_session_links` accumulated a fresh row per
 * sign-in for the same user. Deriving both segments from the HMAC of the
 * seed restores the per-user invariant: same user → same grudge_id, the
 * link row is created once, and the cookie/session/view all agree.
 *
 * The 13-digit numeric segment is shaped to match the existing rows
 * (which use ms-since-epoch) so admin tooling that parses the format
 * still works; we just don't claim it's a wall-clock timestamp.
 */
export function mintEphemeralGrudgeId(seed: string): string {
  const digest = createHmac("sha256", getSecret())
    .update(`grudge-id:${seed}`)
    .digest();
  // Map the first 8 bytes of the HMAC into the 1e12..1e13-1 range so the
  // numeric segment always renders as exactly 13 digits.
  const span = 9_000_000_000_000n;
  const base = 1_000_000_000_000n;
  const numeric = (digest.readBigUInt64BE(0) % span) + base;
  const hex = digest.subarray(8, 12).toString("hex").toUpperCase();
  return `GRUDGE-${numeric.toString()}-${hex}`;
}

const isProd = process.env.NODE_ENV === "production";

/**
 * Set the session cookie on an outgoing response.
 *
 * SameSite=Lax keeps the cookie usable on top-level navigations from the
 * Grudge Studio dashboard while still blocking the worst CSRF vectors.
 * Secure is on in production but off in development so localhost works.
 */
export function setSessionCookie(res: Response, sessionId: string): void {
  res.cookie(COOKIE_NAME, buildCookieValue(sessionId), {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/",
    maxAge: SESSION_TTL_MS,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

export function readSessionId(req: Request): string | null {
  // cookie-parser stores parsed cookies on req.cookies; if it isn't
  // wired up, fall back to a tolerant header parse so a misconfigured
  // server still fails closed (returns null) rather than throwing.
  const raw =
    (req.cookies as Record<string, string | undefined> | undefined)?.[
      COOKIE_NAME
    ] ?? readCookieHeader(req.headers.cookie, COOKIE_NAME);
  return parseSessionCookie(raw);
}

function readCookieHeader(
  header: string | undefined,
  name: string,
): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
