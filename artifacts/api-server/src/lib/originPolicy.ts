/**
 * Origin allow-list policy for credentialed cross-origin requests.
 *
 * Why this matters: the auth flow uses HttpOnly cookies and the
 * client's `customFetch` defaults to `credentials: "include"` so
 * cookies ride along on cross-origin requests. With a reflective CORS
 * policy ("just send back whatever Origin you saw") any web page on
 * any domain could mount a login-CSRF: it could POST a Puter token it
 * controls to `/auth/puter/exchange`, the browser would honour the
 * Set-Cookie response, and the victim's subsequent traffic would be
 * billed/scoped to the attacker's Puter identity.
 *
 * The allow-list below is:
 *   - same-origin (no Origin header at all → not a CORS request)
 *   - localhost / 127.0.0.1 on any port (developer machines)
 *   - Replit's preview/janeway/spock/picard subdomains we already
 *     run inside (we explicitly never enable cookies on `replit.com`
 *     itself — only the per-workspace iframe domains)
 *   - anything explicitly listed in `REPLIT_DOMAINS` (deployment-time
 *     hostnames, comma-separated) and a single optional
 *     `EXTRA_ALLOWED_ORIGINS` knob for one-off integrations.
 */

function envList(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Hostnames Replit's iframe proxy uses for live workspace previews. */
const REPLIT_PREVIEW_HOST_RE =
  /^(?:[a-z0-9-]+\.)*(?:replit\.dev|replit\.app|replit\.com|janeway\.replit\.dev|picard\.replit\.dev|spock\.replit\.dev|riker\.replit\.dev)$/i;

/** Compile the union of allow-list rules once at module load. */
const ALLOWED_HOSTS = new Set<string>([
  "localhost",
  "127.0.0.1",
  ...envList("REPLIT_DOMAINS").map(stripPort),
  ...envList("EXTRA_ALLOWED_ORIGINS").map((o) => safeHost(o) ?? o),
]);

function safeHost(origin: string): string | null {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function stripPort(s: string): string {
  return s.replace(/:\d+$/, "").toLowerCase();
}

/**
 * @returns true if the supplied Origin header is allowed to make
 *          credentialed requests against this server. `null`/`undefined`
 *          (meaning "no Origin header sent") is allowed: same-origin
 *          requests omit the header in many browsers, and curl/server
 *          callers never send one.
 */
export function isOriginAllowed(origin: string | null | undefined): boolean {
  if (!origin) return true;
  const host = safeHost(origin);
  if (!host) return false;
  if (ALLOWED_HOSTS.has(host)) return true;
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (REPLIT_PREVIEW_HOST_RE.test(host)) return true;
  return false;
}

/** Snapshot of the policy for logging on startup so ops can sanity-check. */
export function describeOriginPolicy(): string {
  return [
    "localhost / 127.0.0.1",
    "*.replit.{dev,app,com}",
    `REPLIT_DOMAINS=${process.env.REPLIT_DOMAINS ?? "(unset)"}`,
    `EXTRA_ALLOWED_ORIGINS=${process.env.EXTRA_ALLOWED_ORIGINS ?? "(unset)"}`,
  ].join(", ");
}
