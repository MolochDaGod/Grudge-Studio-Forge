import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import {
  useListPrefabs,
  useDeletePrefab,
  useUpdatePrefab,
  useCreatePrefab,
  useCreateScript,
  getListPrefabsQueryKey,
  getListScriptsQueryKey,
} from "@workspace/api-client-react";
import type { Prefab } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/store/auth";
import { useEditor } from "@/store/editor";
import { useViewportTabs } from "@/store/viewportTabs";
import {
  pushPrefabToCloud,
  deletePrefabFromCloud,
  planPrefabSync,
  recordSync,
  retryPendingDeletes,
} from "@/lib/cloud/prefabSync";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { SceneEntity } from "@/scene/types";
import type { PrefabPayload } from "@/scene/prefabPayload";
import { STARTER_PREFABS, STARTER_VFX, type StarterPrefabDef } from "@/lib/starterPrefabs";
import { warmBuiltinModelsForEntities } from "@/lib/modelPreload";

export function PrefabsPanel() {
  const projectId = useEditor((s) => s.projectId);
  const pushLog = useEditor((s) => s.pushLog);
  const spawnPrefabEntities = useEditor((s) => s.spawnPrefabEntities);
  const openTab = useViewportTabs((s) => s.openTab);
  const openPrefabSubScene = useEditor((s) => s.openPrefabSubScene);
  const prefabSubScene = useEditor((s) => s.prefabSubScene);
  const closePrefabSubScene = useEditor((s) => s.closePrefabSubScene);
  const getPrefabBufferEntities = useEditor((s) => s.getPrefabBufferEntities);
  const isDirty = useEditor((s) => s.isDirty);
  const markSaved = useEditor((s) => s.markSaved);
  const hotbar = useEditor((s) => s.hotbar);
  const setHotbar = useEditor((s) => s.setHotbar);
  const setHotbarSlot = useEditor((s) => s.setHotbarSlot);

  const qc = useQueryClient();
  const isPuterSignedIn = useAuth((s) => s.isPuterSignedIn);
  // Fire-and-forget cloud mirror that surfaces *real* failures (vs. guest
  // skips) in the activity log. Wrapping at the call site keeps the
  // happy-path mutation handlers free of try/catch noise.
  const mirrorPush = (p: Prefab, label: string) => {
    pushPrefabToCloud(p)
      .then((r) => {
        if (!r.ok && !r.skipped) {
          pushLog("warn", `Cloud push of "${label}" failed: ${r.reason}`);
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        pushLog("warn", `Cloud push of "${label}" failed: ${msg}`);
      });
  };
  const mirrorDelete = (projectIdArg: number, localId: number, label: string) => {
    deletePrefabFromCloud(projectIdArg, localId)
      .then((r) => {
        if (!r.ok && !r.skipped) {
          pushLog("warn", `Cloud delete of "${label}" failed: ${r.reason}`);
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        pushLog("warn", `Cloud delete of "${label}" failed: ${msg}`);
      });
  };
  const { data: prefabs = [], isLoading } = useListPrefabs(projectId ?? 0, {
    query: { queryKey: getListPrefabsQueryKey(projectId ?? 0), enabled: !!projectId },
  });
  const deletePrefab = useDeletePrefab();
  const updatePrefab = useUpdatePrefab();
  const createPrefab = useCreatePrefab();
  const createScript = useCreateScript();

  // ── Cross-device prefab sync via Puter cloud ───────────────────────
  //
  // Once per (project, signed-in) pair: walk the cloud sidecar dir at
  // `Grudge/prefabs/<projectId>/`, last-write-wins reconcile against the
  // local API copy, and surface a single toast covering anything where the
  // local copy was newer (so the user knows their edits propagated rather
  // than being overwritten). Relies on the prefabs query already having
  // resolved — `prefabs` is `[]` until then, which is fine: we only run
  // the pass after `isLoading` flips false.
  const syncedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!projectId || isLoading) return;
    if (!isPuterSignedIn) {
      syncedRef.current = null;
      return;
    }
    const key = `${projectId}:${isPuterSignedIn ? 1 : 0}`;
    if (syncedRef.current === key) return;
    syncedRef.current = key;
    let cancelled = false;
    (async () => {
      try {
        const result = await planPrefabSync(projectId, prefabs);
        if (cancelled) return;
        if (!result.ok) {
          // Fail-closed: list/read of cloud sidecars failed, so we
          // don't trust the snapshot. Skipping every push/pull this
          // pass prevents stale local copies from clobbering cloud
          // data on a transient Puter error. Reset the synced flag so
          // the next mount can retry.
          syncedRef.current = null;
          pushLog(
            "warn",
            `Prefab cloud sync skipped (cloud unreachable): ${result.reason}`,
          );
          return;
        }
        const { plan, pendingDeletes } = result;
        // Apply cloud-newer copies first so the local list reflects the
        // freshest data before we push anything back up.
        for (const { local, cloud: rec } of plan.toUpdateLocal) {
          await updatePrefab.mutateAsync({
            id: local.id,
            data: { name: rec.name, data: rec.data },
          });
          // Anchor the conflict clock to the cloud's `updatedAt` (NOT
          // whatever the API server stamped on this pull-driven write).
          // Otherwise the next reconcile would see the synthetic local
          // freshness and push it back up as a phantom "newer local copy".
          recordSync(projectId, local.id, rec.cloudId, rec.updatedAt);
        }
        for (const rec of plan.toCreateLocal) {
          const made = await createPrefab.mutateAsync({
            data: { projectId, name: rec.name, data: rec.data },
          });
          // Same baseline rule for cloud-only adds — bind the freshly-
          // minted local id to the cloud's identity *and* timestamp so
          // we don't duplicate the sidecar on the next pass.
          recordSync(projectId, made.id, rec.cloudId, rec.updatedAt);
        }
        // Push local-newer (and local-only) up. Awaited so the summary
        // log line below reflects what actually landed.
        for (const local of plan.toPushCloud) {
          const r = await pushPrefabToCloud(local).catch((err: unknown) => ({
            ok: false as const,
            skipped: false as const,
            reason: err instanceof Error ? err.message : String(err),
          }));
          if (!r.ok && !r.skipped) {
            pushLog(
              "warn",
              `Cloud push of "${local.name}" failed: ${r.reason}`,
            );
          }
        }
        if (
          plan.toUpdateLocal.length > 0 ||
          plan.toCreateLocal.length > 0
        ) {
          qc.invalidateQueries({ queryKey: getListPrefabsQueryKey(projectId) });
          pushLog(
            "info",
            `Prefab sync · pulled ${plan.toUpdateLocal.length + plan.toCreateLocal.length} from cloud, pushed ${plan.toPushCloud.length}.`,
          );
        } else if (plan.toPushCloud.length > 0) {
          pushLog(
            "info",
            `Prefab sync · pushed ${plan.toPushCloud.length} to cloud.`,
          );
        }
        // Retry queued cloud-deletes that failed on a previous run so
        // the orphan sidecar doesn't loop back as `toCreateLocal` next
        // time. We do this AFTER pulls so a successful retry doesn't
        // race a stale create.
        if (pendingDeletes.length > 0) {
          const retry = await retryPendingDeletes(projectId);
          if (retry.ok.length > 0) {
            pushLog(
              "info",
              `Prefab sync · cleared ${retry.ok.length} pending cloud delete${retry.ok.length === 1 ? "" : "s"}.`,
            );
          }
          if (retry.stillPending.length > 0) {
            pushLog(
              "warn",
              `Prefab sync · ${retry.stillPending.length} cloud delete${retry.stillPending.length === 1 ? "" : "s"} still pending; will retry next session.`,
            );
          }
        }
        if (plan.localNewerNames.length > 0) {
          const list = plan.localNewerNames.slice(0, 3).join(", ");
          const more =
            plan.localNewerNames.length > 3
              ? ` (+${plan.localNewerNames.length - 3} more)`
              : "";
          toast.info(
            `You have a newer local copy of ${list}${more} — pushed to Puter cloud.`,
          );
        }
      } catch (err) {
        // Reconcile failures shouldn't block the panel — surface in the log.
        pushLog(
          "warn",
          `Prefab cloud sync failed: ${(err as Error).message}`,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
    // We deliberately omit `prefabs`, `updatePrefab`, `createPrefab`, `qc`,
    // and `pushLog` from the deps: the reconcile is one-shot per project
    // sign-in pair, and re-running it on every prefab list change would
    // create a feedback loop with the mutations it issues.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, isPuterSignedIn, isLoading]);

  // Auto-fill the hotbar the FIRST time a project shows starter prefabs and
  // the hotbar is still entirely empty. We match by name (case-insensitive)
  // since prefab ids are user-specific. This runs at most once per project.
  const autoFilledRef = useRef<number | null>(null);
  useEffect(() => {
    if (!projectId || prefabs.length === 0) return;
    if (autoFilledRef.current === projectId) return;
    if (hotbar.some((s) => s != null)) {
      autoFilledRef.current = projectId; // already configured — leave alone
      return;
    }
    const byName = new Map<string, Prefab>();
    for (const p of prefabs) byName.set(p.name.toLowerCase(), p);
    const next: (number | null)[] = [...hotbar];
    let filled = false;
    for (const def of STARTER_PREFABS) {
      const match = byName.get(def.name.toLowerCase());
      if (match && next[def.slot - 1] == null) {
        next[def.slot - 1] = match.id;
        filled = true;
      }
    }
    if (filled) {
      setHotbar(next);
      pushLog("info", `Auto-filled hotbar from existing starter prefabs.`);
    }
    autoFilledRef.current = projectId;
  }, [projectId, prefabs, hotbar, setHotbar, pushLog]);

  const onSpawn = (p: Prefab) => {
    const data = p.data as PrefabPayload;
    if (!data?.entities || data.entities.length === 0) {
      pushLog("warn", `Prefab "${p.name}" is empty.`);
      return;
    }
    const root = spawnPrefabEntities(data.entities, p.id);
    if (root) pushLog("info", `Spawned prefab "${p.name}" → ${root.name}`);
  };

  const onOpen = (p: Prefab) => {
    const data = p.data as PrefabPayload;
    if (!data?.entities || data.entities.length === 0) {
      pushLog("warn", `Prefab "${p.name}" is empty — open with Save-as-Prefab from the hierarchy first.`);
      return;
    }
    openPrefabSubScene(p.id, p.name, data.entities);
    pushLog("info", `Opened prefab "${p.name}" for editing in sub-scene.`);
  };

  const onSavePrefabBuffer = async () => {
    if (!prefabSubScene || !projectId) return;
    const entities = getPrefabBufferEntities();
    try {
      const updated = await updatePrefab.mutateAsync({
        id: prefabSubScene.prefabId,
        data: {
          name: prefabSubScene.prefabName,
          data: { entities, rootId: entities[0]?.id ?? null },
        },
      });
      qc.invalidateQueries({ queryKey: getListPrefabsQueryKey(projectId) });
      markSaved();
      pushLog("info", `Saved prefab "${prefabSubScene.prefabName}" (${entities.length} entities)`);
      // Mirror the new revision up to Puter so the user's other devices
      // pick it up on next reconcile. Fire-and-forget — the local save
      // already succeeded.
      mirrorPush(updated, updated.name);
    } catch (err) {
      pushLog("error", `Save prefab failed: ${(err as Error).message}`);
    }
  };

  const onCloseSubScene = () => {
    if (isDirty) {
      const ok = confirm(
        "Close prefab sub-scene? You have unsaved prefab changes — they will be discarded.",
      );
      if (!ok) return;
    }
    closePrefabSubScene();
  };

  /**
   * Toggle the "default Player" flag on a prefab. At most one prefab per
   * project should carry this flag at a time, so flipping it ON also clears
   * it from any other prefab. The flag is stashed inside `prefab.data`
   * (a JSON blob) — adding a column would have required an OpenAPI/Drizzle
   * round-trip with no behavioural payoff. Toolbar's Play handler reads it.
   */
  const onTogglePlayerPrefab = async (target: Prefab) => {
    if (!projectId) return;
    const targetData = (target.data as PrefabPayload) ?? {};
    const turningOn = !targetData.isPlayerPrefab;
    try {
      if (turningOn) {
        // Mutual exclusion. Clear OTHERS *first* — if any clear fails we
        // bail out before flipping the target on, so the user never sees
        // two simultaneous players. Sequenced (not Promise.all) so a
        // mid-loop failure leaves the unflipped state recoverable.
        for (const other of prefabs) {
          if (other.id === target.id) continue;
          const od = (other.data as PrefabPayload) ?? {};
          if (!od.isPlayerPrefab) continue;
          await updatePrefab.mutateAsync({
            id: other.id,
            data: {
              name: other.name,
              data: {
                entities: od.entities ?? [],
                rootId: od.rootId ?? null,
                isPlayerPrefab: false,
              },
            },
          });
        }
      }
      // Now flip the target. If turning ON, all previous players are
      // already cleared above; if turning OFF, this is a single mutation
      // with no other state to manage.
      const updatedTarget = await updatePrefab.mutateAsync({
        id: target.id,
        data: {
          name: target.name,
          data: {
            entities: targetData.entities ?? [],
            rootId: targetData.rootId ?? null,
            isPlayerPrefab: turningOn,
          },
        },
      });
      qc.invalidateQueries({ queryKey: getListPrefabsQueryKey(projectId) });
      // Mirror the player-flag flip — and any prefabs we cleared above —
      // to Puter so the mutual-exclusion invariant survives a device hop.
      if (isPuterSignedIn) {
        mirrorPush(updatedTarget, updatedTarget.name);
        if (turningOn) {
          for (const other of prefabs) {
            if (other.id === target.id) continue;
            const od = (other.data as PrefabPayload) ?? {};
            if (od.isPlayerPrefab) {
              mirrorPush(
                {
                  ...other,
                  data: {
                    entities: od.entities ?? [],
                    rootId: od.rootId ?? null,
                    isPlayerPrefab: false,
                  },
                  updatedAt: new Date().toISOString(),
                },
                other.name,
              );
            }
          }
        }
      }
      pushLog(
        "info",
        turningOn
          ? `"${target.name}" is now the default Player — Play will auto-spawn it.`
          : `Cleared default-Player flag from "${target.name}".`,
      );
    } catch (err) {
      pushLog("error", `Toggle player prefab failed: ${(err as Error).message}`);
    }
  };

  const onDelete = async (p: Prefab) => {
    if (!projectId) return;
    if (!confirm(`Delete prefab "${p.name}"? Existing scene instances will remain.`)) return;
    try {
      await deletePrefab.mutateAsync({ id: p.id });
      qc.invalidateQueries({ queryKey: getListPrefabsQueryKey(projectId) });
      // Drop the cloud sidecar too — otherwise the next reconcile would
      // resurrect the prefab from Puter. The mapping is only forgotten
      // on confirmed delete success, so a transient cloud failure will
      // be retried on the next reconcile.
      mirrorDelete(p.projectId, p.id, p.name);
      // Also clear the prefab from any hotbar slot it occupies — leaving a
      // stale id there would break the slot's spawn action.
      if (hotbar.includes(p.id)) {
        setHotbar(hotbar.map((s) => (s === p.id ? null : s)));
      }
      if (prefabSubScene?.prefabId === p.id) {
        // Skip the dirty-check here — the prefab is gone, so changes can't
        // be saved anyway. Just restore the parent scene.
        closePrefabSubScene();
      }
      pushLog("info", `Deleted prefab "${p.name}".`);
    } catch (err) {
      pushLog("error", `Delete prefab failed: ${(err as Error).message}`);
    }
  };

  // --- Seed starter prefabs ---
  //
  // Two-phase per definition: 1) POST a script if defined; 2) POST the prefab
  // (with the new scriptId attached to the right entity if applicable).
  // After all 8 are created we overwrite the hotbar so the new prefabs are
  // immediately bindable to keys 1-8.
  //
  // We deliberately DO NOT skip definitions whose names already exist — the
  // user may have edited them and want a fresh "factory reset" set. They can
  // still delete duplicates afterwards.
  const seedingRef = useRef(false);
  const onSeedStarters = async () => {
    if (!projectId || seedingRef.current) return;
    seedingRef.current = true;
    pushLog("info", `Forging ${STARTER_PREFABS.length} starter prefabs…`);
    const newSlots: (number | null)[] = [...hotbar];
    let created = 0;
    try {
      for (const def of STARTER_PREFABS) {
        try {
          const created_prefab = await createOne(def);
          if (created_prefab) {
            newSlots[def.slot - 1] = created_prefab.id;
            created++;
          }
        } catch (err) {
          pushLog("error", `Starter "${def.name}" failed: ${(err as Error).message}`);
        }
      }
      setHotbar(newSlots);
      qc.invalidateQueries({ queryKey: getListPrefabsQueryKey(projectId) });
      qc.invalidateQueries({ queryKey: getListScriptsQueryKey(projectId) });
      pushLog("info", `Seeded ${created}/${STARTER_PREFABS.length} starters · hotbar bound 1-8.`);
    } finally {
      seedingRef.current = false;
    }
  };

  // Seed the built-in VFX prefabs (model entities pointing at public/builtin
  // GLBs). Skips definitions whose name already exists so repeated clicks
  // don't pile up duplicates.
  const seedingVfxRef = useRef(false);
  const onSeedVfx = async () => {
    if (!projectId || seedingVfxRef.current) return;
    seedingVfxRef.current = true;
    const existingNames = new Set(prefabs.map((p) => p.name));
    const todo = STARTER_VFX.filter((d) => !existingNames.has(d.name));
    if (todo.length === 0) {
      pushLog("info", "VFX prefabs already seeded.");
      seedingVfxRef.current = false;
      return;
    }
    pushLog("info", `Forging ${todo.length} VFX prefab${todo.length === 1 ? "" : "s"}…`);
    let created = 0;
    try {
      for (const def of todo) {
        try {
          const entities = def.entities();
          const made = await createPrefab.mutateAsync({
            data: {
              projectId,
              name: def.name,
              data: { entities, rootId: entities[0]?.id ?? null },
            },
          });
          mirrorPush(made, made.name);
          created++;
        } catch (err) {
          pushLog("error", `VFX "${def.name}" failed: ${(err as Error).message}`);
        }
      }
      qc.invalidateQueries({ queryKey: getListPrefabsQueryKey(projectId) });
      pushLog("info", `Seeded ${created}/${todo.length} VFX prefabs.`);
    } finally {
      seedingVfxRef.current = false;
    }
  };
  const createOne = async (def: StarterPrefabDef) => {
    if (!projectId) return null;
    const entities = def.entities();
    let scriptId: number | null = null;
    if (def.scriptSource && def.scriptName) {
      const script = await createScript.mutateAsync({
        data: {
          projectId,
          name: def.scriptName,
          language: def.scriptLanguage === "csharp" ? "cs" : "js",
          code: def.scriptSource,
        },
      });
      scriptId = script.id;
      const targetIdx = def.scriptTargetIndex ?? 0;
      if (entities[targetIdx]) {
        entities[targetIdx] = { ...entities[targetIdx], scriptId };
      }
    }
    const res = await createPrefab.mutateAsync({
      data: {
        projectId,
        name: def.name,
        data: { entities, rootId: entities[0]?.id ?? null },
      },
    });
    mirrorPush(res, res.name);
    return res;
  };

  const seeding = createPrefab.isPending || createScript.isPending;

  // Row-level helpers for the "Assign to slot" submenu.
  const slotsLabels = useMemo(() => {
    return Array.from({ length: 8 }, (_, i) => {
      const occupant = hotbar[i] != null ? prefabs.find((p) => p.id === hotbar[i]) : null;
      return { i, occupant };
    });
  }, [hotbar, prefabs]);

  if (!projectId) {
    return (
      <div className="p-4 text-xs text-muted-foreground">Open a project to manage prefabs.</div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="font-heading text-[11px] uppercase tracking-[0.22em] text-accent">
            Prefabs
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">
            ({prefabs.length})
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!prefabSubScene && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2.5 text-[10px] font-heading uppercase tracking-[0.18em] text-accent hover:text-accent"
                onClick={onSeedStarters}
                disabled={seeding}
                title="Create 8 ready-to-use starter prefabs and bind them to hotbar slots 1-8"
                data-testid="button-seed-starters"
              >
                {seeding ? (
                  <Loader2 className="size-3 mr-1.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3 mr-1.5" />
                )}
                Seed Starters
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2.5 text-[10px] font-heading uppercase tracking-[0.18em] text-accent hover:text-accent"
                onClick={onSeedVfx}
                disabled={seeding}
                title="Create the built-in VFX prefabs (animated GLB effects)"
                data-testid="button-seed-vfx"
              >
                {seeding ? (
                  <Loader2 className="size-3 mr-1.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3 mr-1.5" />
                )}
                Seed VFX
              </Button>
            </>
          )}
          {prefabSubScene && (
            <>
              <Button
                variant="default"
                size="sm"
                className="h-7 px-3 text-[11px] font-heading uppercase tracking-[0.18em] bg-primary text-primary-foreground hover:bg-primary/90 hover-gold-glow"
                onClick={onSavePrefabBuffer}
                disabled={updatePrefab.isPending}
                data-testid="button-save-prefab-buffer"
              >
                {updatePrefab.isPending && (
                  <Loader2 className="size-3 mr-1.5 animate-spin" />
                )}
                Save Prefab
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-3 text-[11px] font-heading uppercase tracking-[0.18em]"
                onClick={onCloseSubScene}
                data-testid="button-close-prefab-subscene"
              >
                Close Sub-scene
              </Button>
            </>
          )}
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-1.5">
          {isLoading && (
            <div className="text-xs text-muted-foreground">Loading prefabs…</div>
          )}
          {!isLoading && prefabs.length === 0 && (
            <div className="text-xs text-muted-foreground py-6 text-center font-lore italic">
              No prefabs forged yet.
              <br />
              Press
              <span className="text-accent not-italic font-heading mx-1">Seed Starters</span>
              for 8 ready-made prefabs, or select an entity in the Hierarchy and choose
              <span className="text-accent not-italic font-heading mx-1">Save as Prefab</span>.
            </div>
          )}
          {prefabs.map((p) => {
            const data = p.data as PrefabPayload;
            const count = data?.entities?.length ?? 0;
            const editing = prefabSubScene?.prefabId === p.id;
            const slotIdx = hotbar.findIndex((s) => s === p.id);
            return (
              <ContextMenu key={p.id}>
                <ContextMenuTrigger asChild>
                  <div
                    draggable={!prefabSubScene}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/prefab-id", String(p.id));
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    // Warm the GLB cache on intent signals so the first
                    // Spawn click of a heavy model-backed prefab feels
                    // instant. No-op for primitive-only prefabs.
                    onMouseEnter={() => warmBuiltinModelsForEntities(data?.entities)}
                    onFocus={() => warmBuiltinModelsForEntities(data?.entities)}
                    className={`relative flex items-center gap-3 pl-3 pr-2 py-2 rounded-md border transition-colors ${
                      editing
                        ? "bg-primary/10 border-primary/50 gold-glow-sm"
                        : "bg-card border-card-border hover-elevate"
                    }`}
                    data-testid={`prefab-${p.id}`}
                  >
                    <span
                      className={`absolute left-0 top-2 bottom-2 w-[2px] rounded-r ${
                        editing ? "bg-primary" : "bg-primary/40"
                      }`}
                      aria-hidden
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-heading text-[13px] tracking-wide text-foreground truncate flex items-center gap-2">
                        {p.name}
                        {slotIdx >= 0 && (
                          <span
                            className="font-mono text-[9px] text-primary border border-primary/40 rounded px-1 py-[1px]"
                            title={`Bound to hotbar slot ${slotIdx + 1}`}
                          >
                            {slotIdx + 1}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground font-mono">
                        {count} {count === 1 ? "entity" : "entities"} · #{p.id}
                        {editing && (
                          <span className="ml-2 font-heading uppercase tracking-wider text-primary">
                            · editing
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2.5 text-[10px] font-heading uppercase tracking-[0.18em] text-muted-foreground hover:text-accent"
                      onClick={() => onSpawn(p)}
                      disabled={!!prefabSubScene}
                      title="Instantiate a copy in the current scene"
                      data-testid={`button-spawn-prefab-${p.id}`}
                    >
                      Spawn
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2.5 text-[10px] font-heading uppercase tracking-[0.18em] text-muted-foreground hover:text-accent"
                      onClick={() => onOpen(p)}
                      disabled={!!prefabSubScene && !editing}
                      title="Open prefab in its own sub-scene editor"
                      data-testid={`button-open-prefab-${p.id}`}
                    >
                      Open
                    </Button>
                    <button
                      onClick={() => onDelete(p)}
                      className="h-7 px-2 rounded text-[10px] font-heading uppercase tracking-[0.18em] text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      title="Delete prefab"
                      data-testid={`button-delete-prefab-${p.id}`}
                    >
                      Delete
                    </button>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => onSpawn(p)} disabled={!!prefabSubScene}>
                    Spawn in scene
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => onOpen(p)} disabled={!!prefabSubScene && !editing}>
                    Open prefab editor
                  </ContextMenuItem>
                  <ContextMenuItem
                    onClick={() => onTogglePlayerPrefab(p)}
                    disabled={!!prefabSubScene || updatePrefab.isPending}
                    data-testid={`menu-toggle-player-prefab-${p.id}`}
                  >
                    {data?.isPlayerPrefab
                      ? "✓ Default Player (click to clear)"
                      : "Set as default Player"}
                  </ContextMenuItem>
                  <ContextMenuItem
                    onClick={() => {
                      openTab({
                        kind: "prefab",
                        data: { prefabId: p.id, prefabName: p.name },
                      });
                      pushLog("info", `Previewing prefab "${p.name}" in a new tab.`);
                    }}
                    data-testid={`menu-preview-prefab-${p.id}`}
                  >
                    Preview in new tab
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>Assign to slot…</ContextMenuSubTrigger>
                    <ContextMenuSubContent>
                      {slotsLabels.map(({ i, occupant }) => (
                        <ContextMenuItem
                          key={i}
                          onClick={() => {
                            setHotbarSlot(i, p.id);
                            pushLog("info", `Bound "${p.name}" to slot ${i + 1}.`);
                          }}
                        >
                          <span className="font-mono text-[10px] text-muted-foreground mr-2 w-4">
                            {i + 1}
                          </span>
                          {occupant ? (
                            <span className="opacity-70">{occupant.name}</span>
                          ) : (
                            <span className="opacity-50 italic">empty</span>
                          )}
                        </ContextMenuItem>
                      ))}
                      {slotIdx >= 0 && (
                        <>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            onClick={() => {
                              setHotbarSlot(slotIdx, null);
                              pushLog("info", `Cleared slot ${slotIdx + 1}.`);
                            }}
                          >
                            Unbind from slot {slotIdx + 1}
                          </ContextMenuItem>
                        </>
                      )}
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onClick={() => onDelete(p)}
                    className="text-destructive focus:text-destructive"
                  >
                    Delete prefab
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
