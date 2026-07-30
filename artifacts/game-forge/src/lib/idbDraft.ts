/**
 * Large scene draft storage — IndexedDB fallback when localStorage quota fails.
 */
import { get, set, del } from "idb-keyval";

const PREFIX = "gameforge:draft:";

export interface DraftPayload {
  savedAt: number;
  data: unknown;
}

export async function writeDraft(
  sceneId: number,
  payload: DraftPayload,
): Promise<"local" | "idb" | "none"> {
  const key = `${PREFIX}${sceneId}`;
  const raw = JSON.stringify(payload);
  try {
    localStorage.setItem(key, raw);
    // Keep IDB in sync so restore can prefer either
    void set(key, payload).catch(() => undefined);
    return "local";
  } catch {
    try {
      await set(key, payload);
      return "idb";
    } catch {
      return "none";
    }
  }
}

export async function readDraft(sceneId: number): Promise<DraftPayload | null> {
  const key = `${PREFIX}${sceneId}`;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      return JSON.parse(raw) as DraftPayload;
    }
  } catch {
    /* fall through to idb */
  }
  try {
    const v = await get<DraftPayload>(key);
    return v ?? null;
  } catch {
    return null;
  }
}

export async function clearDraft(sceneId: number): Promise<void> {
  const key = `${PREFIX}${sceneId}`;
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  try {
    await del(key);
  } catch {
    /* ignore */
  }
}
