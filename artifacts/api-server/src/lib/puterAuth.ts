/**
 * Server-side Puter token verification.
 *
 * The browser SDK (https://js.puter.com/v2/) hands us a `puter` object
 * after sign-in that holds the access token. We **do not** trust the
 * username/uuid claims the client sends with that token — instead we
 * call Puter's `whoami` endpoint server-to-server with the token as a
 * Bearer credential, and use whatever the API returns. This eliminates
 * any "I lied about my Puter UUID" attack surface.
 *
 * Puter's API base is `https://api.puter.com`. The whoami endpoint
 * returns `{ uuid, username, email_confirmed, email?, ... }`. Newer
 * builds of the SDK call this internally; replicating it on the server
 * gives us the same authority without trusting the page.
 */

export interface PuterIdentity {
  uuid: string;
  username: string;
  email: string | null;
  emailConfirmed: boolean;
  /** Best-effort avatar URL — Puter accounts default to gravatar-style
   *  fallbacks; we surface whatever the API returned. */
  avatarUrl: string | null;
}

/** Configurable so deploys can route through a Grudge-branded proxy if
 *  the wider ecosystem ever fronts Puter. */
function puterApiBase(): string {
  return (
    process.env.PUTER_API_BASE ??
    process.env.PUTER_SITE_ORIGIN?.replace(/\/$/, "").replace(
      /^(https?:\/\/)/,
      "$1api.",
    ) ??
    "https://api.puter.com"
  );
}

export class PuterAuthError extends Error {
  readonly status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = "PuterAuthError";
    this.status = status;
  }
}

/**
 * Validate a Puter access token and return the authoritative identity.
 *
 * We give the request a tight timeout — the auth flow blocks on this so
 * a slow Puter API would visibly stall sign-in. 8s is generous; real
 * responses are typically <500ms.
 */
export async function verifyPuterToken(token: string): Promise<PuterIdentity> {
  if (!token || typeof token !== "string" || token.length < 10) {
    throw new PuterAuthError("Missing Puter access token", 400);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);

  let res: Response;
  try {
    res = await fetch(`${puterApiBase()}/whoami`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
      },
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new PuterAuthError(
      `Puter whoami request failed: ${(err as Error).message}`,
      502,
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    throw new PuterAuthError("Puter rejected the access token", 401);
  }
  if (!res.ok) {
    throw new PuterAuthError(
      `Puter whoami returned ${res.status}`,
      res.status >= 500 ? 502 : 401,
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new PuterAuthError("Puter whoami response was not JSON", 502);
  }

  const uuid =
    typeof body.uuid === "string" && body.uuid.length > 0
      ? body.uuid
      : typeof body.id === "string"
        ? body.id
        : null;
  const username =
    typeof body.username === "string" ? body.username : null;
  if (!uuid || !username) {
    throw new PuterAuthError(
      "Puter whoami response missing uuid/username",
      502,
    );
  }

  const email =
    typeof body.email === "string" && body.email.length > 0
      ? body.email
      : null;
  const emailConfirmed =
    body.email_confirmed === true || body.email_verified === true;
  const avatarUrl =
    typeof body.avatar_url === "string"
      ? body.avatar_url
      : typeof body.picture === "string"
        ? body.picture
        : null;

  return { uuid, username, email, emailConfirmed, avatarUrl };
}
