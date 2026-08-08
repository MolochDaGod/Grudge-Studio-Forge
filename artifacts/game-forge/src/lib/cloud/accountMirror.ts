/**
 * Optional Puter KV mirror of Railway account snapshot.
 *
 * Law: Railway is SSOT. Puter mirror is cache for UI / offline display only.
 * Never write bag mutations only to Puter.
 *
 * Docs: docs/ACCOUNT_PUTER_ENGINE_SSOT.md
 */
import { FORGE_ENV } from "@/lib/forgeEnv";
import { getGrudgeBearerToken } from "@/lib/grudgeAuthBridge";
import { cloud, isPuterSignedIn } from "@/lib/cloud/puterCloud";

export type AccountMirrorPayload = {
  at: number;
  source: string;
  note: "mirror-only-not-ssot";
  me?: unknown;
  account?: unknown;
  wallet?: unknown;
  characters?: unknown;
};

function mirrorKey(grudgeId: string): string {
  return `${FORGE_ENV.puter.kvAccountMirrorPrefix}${grudgeId}`;
}

/** Fetch Railway account planes with Grudge JWT (no secrets in client). */
export async function fetchRailwayAccountSnapshot(): Promise<{
  ok: boolean;
  grudgeId?: string;
  me?: unknown;
  account?: unknown;
  wallet?: unknown;
  characters?: unknown;
  error?: string;
}> {
  const token = getGrudgeBearerToken();
  if (!token) {
    return { ok: false, error: "no Grudge JWT — sign in with Grudge ID" };
  }
  const headers: HeadersInit = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  const base = FORGE_ENV.gameApi.replace(/\/$/, "");

  try {
    const [meRes, accRes, walRes, charRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers }),
      fetch(`${base}/api/account`, { headers }),
      fetch(`${base}/api/wallet`, { headers }),
      fetch(`${base}/api/characters`, { headers }),
    ]);

    const me = meRes.ok ? await meRes.json() : null;
    const account = accRes.ok
      ? await accRes.json()
      : accRes.status === 404
        ? null
        : null;
    const wallet = walRes.ok ? await walRes.json() : null;
    const characters = charRes.ok ? await charRes.json() : null;

    const grudgeId =
      (me &&
        typeof me === "object" &&
        ((me as { grudgeId?: string; grudge_id?: string; id?: string | number })
          .grudgeId ||
          (me as { grudge_id?: string }).grudge_id ||
          String((me as { id?: string | number }).id ?? ""))) ||
      "unknown";

    if (grudgeId && grudgeId !== "unknown") {
      try {
        localStorage.setItem("grudge_account_id", String(grudgeId));
      } catch {
        /* */
      }
    }

    return {
      ok: !!(me || account || wallet || characters),
      grudgeId: String(grudgeId),
      me,
      account,
      wallet,
      characters,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Pull Railway snapshot and, if Puter is linked, store KV mirror.
 * Safe to call after Grudge ID login / panel open.
 */
export async function syncAccountMirrorToPuter(): Promise<{
  ok: boolean;
  mirrored: boolean;
  grudgeId?: string;
  error?: string;
}> {
  const snap = await fetchRailwayAccountSnapshot();
  if (!snap.ok) {
    return { ok: false, mirrored: false, error: snap.error };
  }

  const payload: AccountMirrorPayload = {
    at: Date.now(),
    source: FORGE_ENV.gameApi,
    note: "mirror-only-not-ssot",
    me: snap.me,
    account: snap.account,
    wallet: snap.wallet,
    characters: snap.characters,
  };

  // Always keep a local lightweight mirror for UI
  try {
    localStorage.setItem(
      `grudge.forge.accountMirror`,
      JSON.stringify({
        at: payload.at,
        grudgeId: snap.grudgeId,
        hasMe: !!snap.me,
        hasWallet: !!snap.wallet,
        characterCount: Array.isArray(snap.characters)
          ? snap.characters.length
          : (snap.characters as { characters?: unknown[] })?.characters
              ?.length ?? 0,
      }),
    );
  } catch {
    /* */
  }

  if (!isPuterSignedIn() || !snap.grudgeId) {
    return {
      ok: true,
      mirrored: false,
      grudgeId: snap.grudgeId,
      error: isPuterSignedIn() ? undefined : "Puter not linked — local mirror only",
    };
  }

  const r = await cloud.kv.set(mirrorKey(snap.grudgeId), payload);
  return {
    ok: r.ok,
    mirrored: r.ok,
    grudgeId: snap.grudgeId,
    error: r.ok ? undefined : r.message || r.reason,
  };
}

export async function readAccountMirrorFromPuter(
  grudgeId: string,
): Promise<AccountMirrorPayload | null> {
  if (!isPuterSignedIn()) return null;
  const r = await cloud.kv.get<AccountMirrorPayload>(mirrorKey(grudgeId));
  if (!r.ok || !r.data) return null;
  return r.data;
}
