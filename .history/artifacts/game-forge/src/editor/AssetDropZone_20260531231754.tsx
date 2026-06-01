import { useEffect, useRef, useState, useCallback } from "react";
import { useUpload } from "@workspace/object-storage-web";
import { useCreateAsset, getListAssetsQueryKey, getGetProjectSummaryQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEditor } from "@/store/editor";
import { inspectGlb, type GlbInfo } from "@/lib/glbInspect";
import { classifyDroppedFile, CONVERTIBLE_3D_KINDS, type DroppedFileKind } from "@/lib/fileKind";
import { GlbInspectorDialog, type InspectorPayload } from "./GlbInspectorDialog";
import type { SceneData } from "@/scene/types";
import { UploadCloud, FileBox, Image as ImageIcon, FileJson, Music2, Boxes, FileArchive } from "lucide-react";

/**
 * Full-document drag-and-drop overlay. Accepts:
 *
 *   .glb / .gltf       → upload, decode binary header, open Inspector
 *   .obj / .fbx / .stl → convert to GLB in-browser (three-stdlib + GLTFExporter),
 *                        upload, open Inspector
 *   .zip               → extract + convert every supported file inside
 *   .png/.jpg/.webp/…  → upload as image asset
 *   .mp3/.wav/.ogg/…   → upload as audio asset
 *   .json / .gfscene   → import as scene if it matches SceneData shape
 *
 * Mounts at the app root so a drop anywhere is captured.
 */
export function AssetDropZone({ children }: { children: React.ReactNode }) {
  const projectId = useEditor((s) => s.projectId);
  const pushLog = useEditor((s) => s.pushLog);
  const addEntity = useEditor((s) => s.cmdAddEntity);
  const updateEntity = useEditor((s) => s.cmdUpdateEntity);
  const setSceneData = useEditor((s) => s.setSceneData);
  const setSceneName = useEditor((s) => s.setSceneName);

  const qc = useQueryClient();
  const createAsset = useCreateAsset();
  const { uploadFile } = useUpload({
    onError: (err: Error) => pushLog("error", `Upload failed: ${err.message}`),
  });

  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [inspector, setInspector] = useState<InspectorPayload | null>(null);
  const dragDepth = useRef(0);

  const recordAsset = useCallback(
    async (name: string, url: string, type: "model" | "image" | "audio" | "other") => {
      if (!projectId) return null;
      const created = await createAsset.mutateAsync({
        data: { projectId, name, url, type, source: "upload" },
      });
      qc.invalidateQueries({ queryKey: getListAssetsQueryKey(projectId) });
      qc.invalidateQueries({ queryKey: getGetProjectSummaryQueryKey(projectId) });
      return created;
    },
    [projectId, createAsset, qc],
  );

  const importSceneJson = useCallback(
    (text: string, fileName: string) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        pushLog("error", `${fileName}: not valid JSON (${(err as Error).message})`);
        return;
      }
      const data = parsed as Partial<SceneData>;
      if (!data || !Array.isArray(data.entities)) {
        pushLog("warn", `${fileName}: doesn't look like a scene (missing 'entities' array)`);
        return;
      }
      const env = data.environment ?? {};
      // command-stack: bypass — wholesale scene replace on import (same
      // contract as the documented setSceneData bypass in store/editor.ts).
      setSceneData({ entities: data.entities, environment: env });
      const cleanName = fileName.replace(/\.(gfscene\.)?json$/i, "").replace(/\.gfscene$/i, "");
      setSceneName(cleanName || "Imported Scene");
      pushLog(
        "info",
        `Imported scene "${fileName}" — ${data.entities.length} entities. Save to keep.`,
      );
    },
    [pushLog, setSceneData, setSceneName],
  );

  const route = useCallback(
    async (file: File, opts: { openInspector: boolean } = { openInspector: true }) => {
      const kind = classifyDroppedFile(file);
      if (!kind) {
        pushLog("warn", `Unsupported file: ${file.name}`);
        return;
      }

      if (kind === "scene-json") {
        setBusy(`Reading ${file.name}…`);
        try {
          const text = await file.text();
          importSceneJson(text, file.name);
        } finally {
          setBusy(null);
        }
        return;
      }

      if (!projectId) {
        pushLog("warn", `Open a project before importing "${file.name}"`);
        window.alert(`Open or create a project first — "${file.name}" can't be imported without one.`);
        return;
      }

      try {
        if (kind === "glb" || kind === "gltf") {
          setBusy(`Uploading ${file.name}…`);
          let info: GlbInfo | undefined;
          if (kind === "glb") {
            try {
              info = inspectGlb(await file.arrayBuffer());
            } catch (err) {
              pushLog("warn", `GLB header decode failed: ${(err as Error).message}`);
            }
          }
          const res = await uploadFile(file, { projectId, assetType: "model" });
          if (!res) return;
          const url = `/api/storage${res.objectPath}`;
          const asset = await recordAsset(file.name, url, "model");
          pushLog(
            "info",
            info
              ? `Decoded ${file.name}: ${info.json.counts.meshes} meshes, ${info.json.counts.materials} materials, ${info.json.counts.animations} animations`
              : `Uploaded ${file.name}`,
          );
          if (opts.openInspector) {
            setInspector({
              fileName: file.name,
              fileSize: file.size,
              glb: info,
              modelUrl: url,
              assetId: asset?.id,
            });
          }
        } else if (CONVERTIBLE_3D_KINDS.has(kind) || kind === "zip") {
          setBusy(`Converting ${file.name} → GLB…`);
          pushLog("info", `Converting ${kind.toUpperCase()} → GLB in-browser…`);
          // Lazy-load the three.js + three-stdlib pipeline only when a
          // convertible 3D file (or a ZIP wrapping one) is actually dropped.
          const { convertFile } = await import("@/lib/assetConverter");
          const converted = await convertFile(file, (pct, msg) => {
            setBusy(`${msg} (${Math.round(pct * 100)}%)`);
          });
          if (converted.length === 0) {
            pushLog("warn", `${file.name}: no convertible assets found`);
            return;
          }
          // For ZIP drops with multiple results, only open the inspector
          // for the first model — the rest upload silently.
          let inspectorAssignedLocal = false;
          for (const result of converted) {
            const glbBlob = new File([result.data as BlobPart], result.outputName, {
              type: result.contentType,
            });
            let info: GlbInfo | undefined;
            if (result.contentType === "model/gltf-binary") {
              try {
                info = inspectGlb(await glbBlob.arrayBuffer());
              } catch {
                /* ignore */
              }
            }
            setBusy(`Uploading ${glbBlob.name}…`);
            const assetType = result.contentType.startsWith("image/")
              ? "image"
              : result.contentType.startsWith("audio/")
                ? "audio"
                : "model";
            const res = await uploadFile(glbBlob, { projectId, assetType });
            if (!res) continue;
            const url = `/api/storage${res.objectPath}`;
            const asset = await recordAsset(glbBlob.name, url, assetType);
            pushLog(
              "info",
              result.converted
                ? `Converted & uploaded ${glbBlob.name}`
                : `Uploaded ${glbBlob.name}`,
            );
            if (opts.openInspector && assetType === "model" && !inspectorAssignedLocal) {
              setInspector({
                fileName: glbBlob.name,
                fileSize: glbBlob.size,
                glb: info,
                modelUrl: url,
                assetId: asset?.id,
              });
              inspectorAssignedLocal = true;
            }
          }
        } else if (kind === "image" || kind === "audio") {
          setBusy(`Uploading ${file.name}…`);
          const assetType = kind === "image" ? "image" : "audio";
          const res = await uploadFile(file, { projectId, assetType });
          if (!res) return;
          const url = `/api/storage${res.objectPath}`;
          await recordAsset(file.name, url, assetType);
          pushLog("info", `Uploaded ${kind} "${file.name}"`);
        }
      } catch (err) {
        pushLog("error", `Import failed: ${(err as Error).message}`);
      } finally {
        setBusy(null);
      }
    },
    [projectId, importSceneJson, pushLog, uploadFile, recordAsset],
  );

  const onAddToScene = useCallback(
    (p: InspectorPayload) => {
      const e = addEntity("model", p.fileName.replace(/\.(glb|gltf)$/i, ""));
      updateEntity(e.id, (d) => {
        d.model = { url: p.modelUrl, assetId: p.assetId };
      });
      pushLog("info", `Added "${p.fileName}" to scene as ${e.id}`);
      setInspector(null);
    },
    [addEntity, updateEntity, pushLog],
  );

  // Document-level drag listeners
  useEffect(() => {
    const onEnter = (e: DragEvent) => {
      // Ignore drags that don't carry files (e.g. dragging items inside the UI)
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      dragDepth.current += 1;
      setOver(true);
    };
    const onOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setOver(false);
    };
    const onDrop = async (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      dragDepth.current = 0;
      setOver(false);
      const files = Array.from(e.dataTransfer.files ?? []);
      // For multi-file drops, only open the inspector for the *first* model
      // so subsequent drops don't clobber a dialog the user is reading. The
      // rest are uploaded silently and reported via the console.
      const single = files.length === 1;
      let inspectorAssigned = !single;
      for (const f of files) {
        const kind = classifyDroppedFile(f);
        const isModel = kind === "glb" || kind === "gltf" || kind === "obj";
        const open = single || (isModel && !inspectorAssigned);
        if (open && isModel) inspectorAssigned = true;
        await route(f, { openInspector: open });
      }
      if (files.length > 1) {
        pushLog("info", `Imported ${files.length} files (batch).`);
      }
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [route]);

  return (
    <>
      {children}

      {/* Drop overlay */}
      {over && (
        <div className="fixed inset-0 z-[100] pointer-events-none flex items-center justify-center bg-background/70 backdrop-blur-sm">
          <div className="px-10 py-8 rounded-xl border-2 border-dashed border-primary bg-card/95 gold-glow-lg text-center">
            <UploadCloud className="size-12 text-primary mx-auto mb-3" />
            <div className="font-display text-xl brand-gold mb-1">Drop to import</div>
            <div className="font-heading text-[11px] uppercase tracking-[0.2em] text-muted-foreground mb-4">
              Grudge Studio · Asset Forge
            </div>
            <div className="flex gap-4 justify-center text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <FileBox className="size-3.5 text-primary" /> .glb .gltf .obj
              </span>
              <span className="flex items-center gap-1.5">
                <ImageIcon className="size-3.5 text-primary" /> .png .jpg .webp
              </span>
              <span className="flex items-center gap-1.5">
                <Music2 className="size-3.5 text-primary" /> .mp3 .wav .ogg
              </span>
              <span className="flex items-center gap-1.5">
                <FileJson className="size-3.5 text-primary" /> .gfscene.json
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Busy toast */}
      {busy && (
        <div className="fixed bottom-6 right-6 z-[99] px-4 py-2 rounded-md bg-card border border-primary/40 gold-glow-sm text-sm font-mono text-foreground flex items-center gap-2">
          <UploadCloud className="size-4 text-primary animate-pulse" />
          {busy}
        </div>
      )}

      <GlbInspectorDialog
        payload={inspector}
        onClose={() => setInspector(null)}
        onAddToScene={onAddToScene}
      />
    </>
  );
}
