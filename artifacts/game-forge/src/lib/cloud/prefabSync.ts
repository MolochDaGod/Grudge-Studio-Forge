/**
 * Cross-device prefab sync via Puter cloud.
 *
 * The API server is our local-per-device cache; Puter cloud is the source of
 * truth when the user is signed in, so the same prefab library follows them
 * from laptop → desktop without manual export/import.
 *
 * Stable identity
 * ---------------
 * Per-device API servers hand out independent numeric prefab ids, and the
 * editor explicitly allows duplicate names (the seed-starters flow
 * deliberately re-creates prefabs with the same name on demand). Neither
 * `id` nor `name` is therefore safe as the cross-device identifier.
 *
 * Instead, every prefab gets a `cloudId` (UUIDv4) that we mint the first
 * time we mirror it. The cloudId is stored in a per-device localStorage
 * map, `grudge:prefabSync:<projectId>`, so the same physical prefab keeps
 * the same cloud filename across saves on this device. When a cloud-only
 * prefab arrives on a different device the reconcile pass creates a fresh
 * local copy and registers the mapping there too — both devices then
 * agree on the cloudId for that prefab.
 *
 * Layout
 * ------
 *   Grudge/prefabs/<projectId>/<cloudId>.json     # one sidecar per prefab
 *
 * Each sidecar is `{ cloudId, projectId, name, data, updatedAt }`. Names
 * are mutable data inside the file; renaming locally just rewrites the
 * sidecar at the same cloudId, so other devices pick up the new name on
 * the next reconcile without losing history.
 *
 * Strategy
 * --------
 *   - cloud-only (cloudId not in local map) → create local + register
 *   - cloud newer than local                → update local in place
 *   - local newer than cloud (or local-only)→ push local up; surface a
 *                                              "you have a newer local
 *                                              copy" toast for any names
 *                                              that *did* exist in the
 *                                              cloud (real conflicts)
 *   - equal                                  → no-op
 *
 * Guests (not signed in with Puter) silently no-op via
 * `cloud.isAvailable()`.
 */
import type { Prefab, PrefabData } from "@workspace/api-client-react";
import { cloud } from "@/lib/cloud/puterCloud";

const PREFAB_ROOT = "Grudge/prefabs";

/** Cloud sidecar payload. Small, JSON, one file per prefab. */
export interface CloudPrefabRecord {
  /** Stable UUID — also the filename stem. Survives renames and id changes. */
  cloudId: string;
  projectId: number;
  name: string;
  data: PrefabData;
  /** ISO timestamp of the most recent local mutation. */
  updatedAt: string;
}

// ── Per-device sync map (localStorage) ───────────────────────────────
//
// Stored as `{ [localId]: { cloudId, syncedAt } }` per project. `syncedAt`
// is the cloud record's `updatedAt` at the moment of the last successful
// sync (push or pull) for this prefab — it's the conflict clock, not the
// local row's `updatedAt`.
//
// Why a separate clock? When we pull a cloud-newer copy we apply it via
// `updatePrefab`, which makes the local API server stamp `updatedAt = now`.
// If we used that as the comparison anchor, the very next reconcile would
// see `local.updatedAt > cloud.updatedAt` for a row the user never touched
// and push back a spurious "newer local copy", oscillating forever. By
// pinning `syncedAt` to the cloud-side timestamp at sync time, "local
// newer" only fires when there was a real local edit since the last sync.
//
// Legacy entries written by an earlier build of this module used a bare
// `string` (just the cloudId). The reader tolerates both shapes.

export interface SyncEntry {
  cloudId: string;
  /** ISO timestamp of the cloud `updatedAt` we last reconciled against. */
  syncedAt: string;
}

interface SyncMap {
  [localId: string]: SyncEntry;
}

function mapKey(projectId: number): string {
  return `grudge:prefabSync:${projectId}`;
}

function readSyncMap(projectId: number): SyncMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(mapKey(projectId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: SyncMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") {
        // Legacy shape — cloudId only, no anchor. Treat as "synced at
        // epoch" so the next reconcile re-anchors against whatever the
        // cloud currently has.
        out[k] = { cloudId: v, syncedAt: "1970-01-01T00:00:00.000Z" };
      } else if (
        v &&
        typeof v === "object" &&
        typeof (v as SyncEntry).cloudId === "string" &&
        typeof (v as SyncEntry).syncedAt === "string"
      ) {
        out[k] = {
          cloudId: (v as SyncEntry).cloudId,
          syncedAt: (v as SyncEntry).syncedAt,
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeSyncMap(projectId: number, map: SyncMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(mapKey(projectId), JSON.stringify(map));
  } catch {
    // Quota or disabled storage — best-effort, sync will simply re-mint
    // a UUID next session. Tolerable degradation.
  }
}

/** Look up the cloudId we've already minted for this local prefab, if any. */
export function getCloudId(projectId: number, localId: number): string | null {
  const map = readSyncMap(projectId);
  return map[String(localId)]?.cloudId ?? null;
}

/** Look up the full sync entry (cloudId + syncedAt anchor). */
export function getSyncEntry(
  projectId: number,
  localId: number,
): SyncEntry | null {
  const map = readSyncMap(projectId);
  return map[String(localId)] ?? null;
}

/** Record a successful sync: bind localId ↔ cloudId and pin the anchor
 *  to the cloud record's `updatedAt`. Idempotent. */
export function recordSync(
  projectId: number,
  localId: number,
  cloudId: string,
  syncedAt: string,
): void {
  const map = readSyncMap(projectId);
  const existing = map[String(localId)];
  if (existing && existing.cloudId === cloudId && existing.syncedAt === syncedAt) {
    return;
  }
  map[String(localId)] = { cloudId, syncedAt };
  writeSyncMap(projectId, map);
}

/** Drop a mapping (after a local delete). */
export function forgetCloudId(projectId: number, localId: number): void {
  const map = readSyncMap(projectId);
  if (!(String(localId) in map)) return;
  delete map[String(localId)];
  writeSyncMap(projectId, map);
}

// ── Pending-delete tombstones ────────────────────────────────────────
//
// When a local delete succeeds but the cloud delete fails (network blip,
// Puter unavailable, etc.) the orphan sidecar is left in the cloud. The
// next reconcile would otherwise see "cloud-only" and resurrect the
// prefab on this device — clearly wrong. We persist the cloudId in a
// tombstone set so reconcile can:
//   1) skip tombstoned cloud records when computing `toCreateLocal`, and
//   2) hand them to the caller for a delete retry.
// Tombstones clear only on a confirmed delete success (or when the
// sidecar genuinely no longer exists in the cloud listing).

function tombstoneKey(projectId: number): string {
  return `grudge:prefabSync:tombstones:${projectId}`;
}

function readTombstones(projectId: number): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(tombstoneKey(projectId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function writeTombstones(projectId: number, set: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    if (set.size === 0) {
      window.localStorage.removeItem(tombstoneKey(projectId));
    } else {
      window.localStorage.setItem(
        tombstoneKey(projectId),
        JSON.stringify([...set]),
      );
    }
  } catch {
    // best-effort
  }
}

function addTombstone(projectId: number, cloudId: string): void {
  const set = readTombstones(projectId);
  if (set.has(cloudId)) return;
  set.add(cloudId);
  writeTombstones(projectId, set);
}

function removeTombstone(projectId: number, cloudId: string): void {
  const set = readTombstones(projectId);
  if (!set.has(cloudId)) return;
  set.delete(cloudId);
  writeTombstones(projectId, set);
}

/** RFC4122 v4 UUID. Prefers `crypto.randomUUID` when available, falls back
 *  to a fast `crypto.getRandomValues`-based generator so older runtimes
 *  (Electron preload, jsdom) still work. */
function newCloudId(): string {
  const c =
    typeof globalThis !== "undefined"
      ? (globalThis as { crypto?: Crypto }).crypto
      : undefined;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // Per RFC 4122 §4.4
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

// ── Cloud paths ──────────────────────────────────────────────────────

function pathFor(projectId: number, cloudId: string): string {
  return `${PREFAB_ROOT}/${projectId}/${cloudId}.json`;
}

function dirFor(projectId: number): string {
  return `${PREFAB_ROOT}/${projectId}`;
}

// ── Mirror operations (called from PrefabsPanel mutations) ───────────

/** Outcome of a mirror operation. `skipped` covers the guest / no-op
 *  paths where there's no real failure to report. */
export type MirrorOutcome =
  | { ok: true }
  | { ok: false; skipped: true; reason: "guest" | "unmapped" }
  | { ok: false; skipped: false; reason: string };

/** Push (or overwrite) one prefab's sidecar. Mints a cloudId on the first
 *  call for this local prefab and pins the `syncedAt` anchor to whatever
 *  we just wrote, so the next reconcile pass treats this push as the new
 *  shared baseline (no spurious "local newer" on the next visit).
 *  Returns a structured outcome so callers can log real cloud failures
 *  instead of silently assuming success. */
export async function pushPrefabToCloud(p: Prefab): Promise<MirrorOutcome> {
  if (!cloud.isAvailable()) return { ok: false, skipped: true, reason: "guest" };
  let cloudId = getCloudId(p.projectId, p.id);
  if (!cloudId) cloudId = newCloudId();
  const rec: CloudPrefabRecord = {
    cloudId,
    projectId: p.projectId,
    name: p.name,
    data: p.data,
    updatedAt: p.updatedAt,
  };
  const res = await cloud.fs.write(pathFor(p.projectId, cloudId), JSON.stringify(rec));
  if (!res.ok) {
    // Don't persist the cloudId mapping if the very first write failed —
    // otherwise we'd "remember" a UUID for a sidecar that doesn't exist
    // and skip retrying it later.
    return {
      ok: false,
      skipped: false,
      reason: res.message ?? res.reason,
    };
  }
  // The cloud record's authoritative timestamp *is* `p.updatedAt` (we
  // just wrote it), so anchor against that.
  recordSync(p.projectId, p.id, cloudId, p.updatedAt);
  return { ok: true };
}

/** Remove a prefab's sidecar after a local delete. Looks up the cloudId
 *  via the local map so duplicate-named prefabs never clobber each other.
 *  On success: drops both the mapping and any tombstone. On failure:
 *  records a tombstone keyed by cloudId so the next reconcile retries
 *  the delete instead of resurrecting the prefab from the orphan
 *  sidecar via the `toCreateLocal` lane. The local id-map entry is
 *  always forgotten because the local prefab no longer exists; the
 *  tombstone is what carries the pending intent. */
export async function deletePrefabFromCloud(
  projectId: number,
  localId: number,
): Promise<MirrorOutcome> {
  if (!cloud.isAvailable())
    return { ok: false, skipped: true, reason: "guest" };
  const cloudId = getCloudId(projectId, localId);
  if (!cloudId) return { ok: false, skipped: true, reason: "unmapped" };
  const res = await cloud.fs.delete(pathFor(projectId, cloudId));
  if (!res.ok) {
    addTombstone(projectId, cloudId);
    forgetCloudId(projectId, localId);
    return {
      ok: false,
      skipped: false,
      reason: res.message ?? res.reason,
    };
  }
  forgetCloudId(projectId, localId);
  removeTombstone(projectId, cloudId);
  return { ok: true };
}

/** Retry every queued delete for a project. Returns the cloudIds whose
 *  retry actually succeeded (caller may log them). Sidecars that have
 *  already vanished (missing-file errors) are treated as "delete
 *  successful" and dropped from the tombstone set so we don't loop
 *  forever on phantom retries. */
export async function retryPendingDeletes(
  projectId: number,
): Promise<{ ok: string[]; stillPending: string[] }> {
  if (!cloud.isAvailable()) return { ok: [], stillPending: [] };
  const tombstones = readTombstones(projectId);
  if (tombstones.size === 0) return { ok: [], stillPending: [] };
  const succeeded: string[] = [];
  const stillPending: string[] = [];
  for (const cloudId of tombstones) {
    const res = await cloud.fs.delete(pathFor(projectId, cloudId));
    if (res.ok || looksLikeMissing(res.message)) {
      removeTombstone(projectId, cloudId);
      succeeded.push(cloudId);
    } else {
      stillPending.push(cloudId);
    }
  }
  return { ok: succeeded, stillPending };
}

// ── Reconcile pass (called once per project on mount) ────────────────

/** Heuristic: does a Puter SDK error message look like "directory or
 *  file does not exist"? Puter doesn't expose a typed code, so we check
 *  common substrings. False positives here only matter on a transient
 *  error that happens to contain "not found" — a correctness vs.
 *  liveness trade we accept (one missed reconcile, retried next mount). */
function looksLikeMissing(message: string | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("not found") ||
    m.includes("does not exist") ||
    m.includes("no such") ||
    m.includes("enoent") ||
    m.includes("subject_does_not_exist")
  );
}

type ListCloudResult =
  | { ok: true; records: CloudPrefabRecord[] }
  | { ok: false; reason: string };

/** List every cloud sidecar under a project's prefab dir.
 *
 * Fail-closed semantics: a missing directory returns `{ok:true,records:[]}`
 * (truly empty cloud), but a transient list error or per-file read
 * failure returns `{ok:false,reason}`. The reconcile caller MUST treat
 * `ok:false` as "cloud state unknown — do nothing" so we never push
 * local copies up on the false assumption that the cloud is empty. */
async function listCloudPrefabs(projectId: number): Promise<ListCloudResult> {
  if (!cloud.isAvailable()) return { ok: true, records: [] };
  const dir = dirFor(projectId);
  const ls = await cloud.fs.list(dir);
  if (!ls.ok) {
    if (looksLikeMissing(ls.message)) return { ok: true, records: [] };
    return { ok: false, reason: ls.message ?? ls.reason };
  }
  const records: CloudPrefabRecord[] = [];
  for (const entry of ls.data) {
    if (entry.is_dir) continue;
    if (!entry.name.endsWith(".json")) continue;
    const r = await cloud.fs.readJson<CloudPrefabRecord>(`${dir}/${entry.name}`);
    if (!r.ok) {
      // A truly-missing file (raced a delete) is benign; any other read
      // failure poisons the whole reconcile.
      if (looksLikeMissing(r.message)) continue;
      return { ok: false, reason: r.message ?? r.reason };
    }
    const rec = r.data;
    // Defensive shape check + back-fill cloudId from filename if a legacy
    // sidecar omitted it. We only trust records whose payload at least
    // looks like a PrefabData blob.
    if (
      rec &&
      typeof rec.name === "string" &&
      typeof rec.updatedAt === "string" &&
      rec.data &&
      Array.isArray(rec.data.entities)
    ) {
      const cloudId =
        typeof rec.cloudId === "string" && rec.cloudId.length > 0
          ? rec.cloudId
          : entry.name.replace(/\.json$/i, "");
      records.push({ ...rec, cloudId, projectId });
    }
  }
  return { ok: true, records };
}

/** A reconcile plan, classified into four buckets. The caller owns
 *  mutating the local API server (so the React Query cache stays
 *  consistent) — we just hand back the work. */
export interface PrefabSyncPlan {
  /** Cloud records to create locally (cloudId not registered on this device). */
  toCreateLocal: CloudPrefabRecord[];
  /** Cloud records that should overwrite the local copy (cloud is newer
   *  than the last shared baseline). */
  toUpdateLocal: Array<{ local: Prefab; cloud: CloudPrefabRecord }>;
  /** Local prefabs whose copy is newer than the cloud (or cloud-missing) —
   *  push them up. */
  toPushCloud: Prefab[];
  /** Names from `toPushCloud` that *did* exist in the cloud but were
   *  superseded by a fresher local edit — a real conflict (both sides
   *  changed since last sync) the user might want to know about. */
  localNewerNames: string[];
}

/**
 * Conflict detection uses the per-prefab `syncedAt` anchor (the cloud's
 * `updatedAt` at our last successful sync), NOT the local row's
 * `updatedAt`. This avoids the oscillation where a fresh pull bumps the
 * local timestamp via the API server and the next reconcile mistakes
 * that synthetic freshness for a real local edit.
 *
 *   localChanged  := local.updatedAt > syncedAt
 *   cloudChanged  := cloud.updatedAt > syncedAt
 *
 *   neither       → no-op
 *   only local    → push
 *   only cloud    → pull
 *   both          → last-write-wins on the actual updatedAt timestamps,
 *                    and if local wins surface a "newer local copy" toast
 */
/** Discriminated result so callers can distinguish "cloud is genuinely
 *  empty / fully reconciled" from "we couldn't read the cloud — do
 *  nothing this pass". */
export type PrefabSyncResult =
  | { ok: true; plan: PrefabSyncPlan; pendingDeletes: string[] }
  | { ok: false; reason: string };

export async function planPrefabSync(
  projectId: number,
  localPrefabs: Prefab[],
): Promise<PrefabSyncResult> {
  const plan: PrefabSyncPlan = {
    toCreateLocal: [],
    toUpdateLocal: [],
    toPushCloud: [],
    localNewerNames: [],
  };
  if (!cloud.isAvailable()) {
    return { ok: true, plan, pendingDeletes: [] };
  }

  // Fail-closed: if we can't trust the cloud snapshot, refuse to plan
  // any pushes/pulls. Pushing on a transient list error would silently
  // overwrite cloud copies with stale local data.
  const listed = await listCloudPrefabs(projectId);
  if (!listed.ok) return { ok: false, reason: listed.reason };
  const cloudRecs = listed.records;

  const tombstones = readTombstones(projectId);
  const cloudById = new Map<string, CloudPrefabRecord>();
  for (const r of cloudRecs) {
    // Skip tombstoned records when computing pulls/creates so a pending
    // delete never resurrects as `toCreateLocal`. The retry of the
    // delete itself happens via `retryPendingDeletes` (returned in
    // `pendingDeletes`).
    if (tombstones.has(r.cloudId)) continue;
    cloudById.set(r.cloudId, r);
  }

  const seenCloudIds = new Set<string>();
  for (const local of localPrefabs) {
    const entry = getSyncEntry(projectId, local.id);
    const remote = entry ? cloudById.get(entry.cloudId) : undefined;
    if (!remote) {
      // No mapping at all → first-time push. If we had a mapping but the
      // sidecar is gone (the user wiped Puter, or a different device
      // hasn't pulled yet), still push to re-establish the baseline.
      plan.toPushCloud.push(local);
      continue;
    }
    seenCloudIds.add(remote.cloudId);

    const syncedTs = Date.parse(entry!.syncedAt);
    const localTs = Date.parse(local.updatedAt);
    const cloudTs = Date.parse(remote.updatedAt);
    if (
      !Number.isFinite(syncedTs) ||
      !Number.isFinite(localTs) ||
      !Number.isFinite(cloudTs)
    ) {
      continue;
    }
    const localChanged = localTs > syncedTs;
    const cloudChanged = cloudTs > syncedTs;

    if (!localChanged && !cloudChanged) continue;
    if (cloudChanged && !localChanged) {
      plan.toUpdateLocal.push({ local, cloud: remote });
      continue;
    }
    if (localChanged && !cloudChanged) {
      plan.toPushCloud.push(local);
      continue;
    }
    // Both sides moved since the last shared baseline → real conflict.
    // Last-write-wins on the absolute timestamps, and surface a toast
    // for the loser-of-cloud case so the user sees their edits won.
    if (cloudTs > localTs) {
      plan.toUpdateLocal.push({ local, cloud: remote });
    } else {
      plan.toPushCloud.push(local);
      plan.localNewerNames.push(local.name);
    }
  }

  // Anything in the cloud we didn't match (and isn't tombstoned) is a
  // cross-device addition.
  for (const remote of cloudRecs) {
    if (tombstones.has(remote.cloudId)) continue;
    if (!seenCloudIds.has(remote.cloudId)) {
      plan.toCreateLocal.push(remote);
    }
  }

  return { ok: true, plan, pendingDeletes: [...tombstones] };
}
