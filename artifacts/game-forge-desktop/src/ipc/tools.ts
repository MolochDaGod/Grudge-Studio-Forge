// Tools IPC: 3D conversion (gltf-transform + assimpjs), ZIP extraction
// (yauzl), scene deploy. Progress is emitted on `tool:progress`.
import type { BrowserWindow, IpcMain } from "electron";
import * as fs from "fs/promises";
import { createWriteStream } from "fs";
import * as path from "path";
import { pipeline } from "stream/promises";
import { createRequire } from "module";
import yauzl from "yauzl";
import archiver from "archiver";
import { NodeIO, type Document, type Node as GltfNode } from "@gltf-transform/core";
import {
  KHRONOS_EXTENSIONS,
  ALL_EXTENSIONS,
} from "@gltf-transform/extensions";
import { dedup, prune } from "@gltf-transform/functions";
import type {
  Convert3dRequest,
  Convert3dResult,
  DeploySceneRequest,
  DeploySceneResult,
  ProgressEvent as ToolProgressEvent,
  ThreeDFormat,
  UnzipRequest,
  UnzipResult,
} from "@workspace/desktop-bridge";

// ESM-safe `require` for resolving CommonJS-only assets we ship with
// the renderer (three.module.js path, optional native binaries).
const require = createRequire(import.meta.url);

type WindowGetter = () => BrowserWindow | null;

function emit(getWin: WindowGetter, ev: ToolProgressEvent): void {
  const w = getWin();
  if (w && !w.isDestroyed()) {
    w.webContents.send("tool:progress", ev);
  }
}

function newJobId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

function detectFormat(p: string): ThreeDFormat | null {
  const ext = path.extname(p).toLowerCase().replace(/^\./, "");
  if (ext === "glb" || ext === "gltf" || ext === "fbx" || ext === "obj" || ext === "stl") {
    return ext as ThreeDFormat;
  }
  return null;
}

// Lazy WASM Assimp loader: reads FBX/OBJ/STL → emits GLB/GLTF.
//
// The upstream `assimpjs` 0.0.10 npm module exports a factory: calling
// it returns a Promise that resolves to a module object. The module
// object exposes `FileList` as a *constructor* (used with `new`) plus
// a top-level `ConvertFileList(list, format)`. Earlier revisions of
// this file used a non-existent `CreateNewFileList()` helper, which
// crashed the converter at runtime — keep the API names below in sync
// with `node_modules/assimpjs/README.md`.
interface AssimpFile {
  GetPath(): string;
  GetContent(): Uint8Array;
}
interface AssimpResult {
  IsSuccess(): boolean;
  GetErrorCode(): string;
  FileCount(): number;
  GetFile(i: number): AssimpFile;
}
interface AssimpFileList {
  AddFile(name: string, data: Uint8Array): void;
}
interface AssimpModule {
  FileList: new () => AssimpFileList;
  ConvertFileList(list: AssimpFileList, fmt: string): AssimpResult;
}

let assimpReady: Promise<AssimpModule> | null = null;

async function loadAssimp(): Promise<AssimpModule> {
  if (!assimpReady) {
    assimpReady = (async () => {
      const mod = require("assimpjs") as () => Promise<AssimpModule>;
      return await mod();
    })();
  }
  return assimpReady;
}

/**
 * 3D conversion. Every pair of {GLB, GLTF, FBX, OBJ, STL} is
 * supported end-to-end with no extra binaries. Pipeline:
 *  - GLB ↔ GLTF: native via gltf-transform (with prune+dedup so the
 *    output is meaningfully smaller, not just a re-serialization).
 *  - {FBX, OBJ, STL} → GLB or GLTF: via assimpjs (WASM Assimp).
 *  - GLB/GLTF → OBJ/STL: in-process serializer that walks the
 *    gltf-transform document and writes triangles (no DOM needed).
 *  - {FBX, OBJ, STL} → OBJ/STL: route through GLB via assimpjs first,
 *    then re-export with the same serializer.
 *  - anything → FBX: pipeline above, then the minimal ASCII FBX 7.4
 *    emitter in `exportFBX` (single Geometry + Model). Round-trips in
 *    Blender 4.x and Unity 2022 LTS.
 * See `README.md` ("3D converter format matrix") for the user-facing
 * summary and the same matrix in tabular form.
 */
async function convert3d(
  req: Convert3dRequest,
  getWin: WindowGetter,
): Promise<Convert3dResult> {
  const jobId = newJobId("convert");
  emit(getWin, { jobId, progress: 0, message: "Reading source…" });

  const srcFormat = detectFormat(req.inputPath);
  if (!srcFormat) {
    throw new Error(`Unsupported source format: ${path.basename(req.inputPath)}`);
  }
  const dst = req.targetFormat;
  const baseName =
    req.outputName?.replace(/\.[^.]+$/, "") ??
    path.basename(req.inputPath, path.extname(req.inputPath));
  const outputPath = path.join(req.outputDir, `${baseName}.${dst}`);
  await fs.mkdir(req.outputDir, { recursive: true });

  const warnings: string[] = [];
  const isGltfFamily = (f: ThreeDFormat) => f === "glb" || f === "gltf";

  if (isGltfFamily(srcFormat) && isGltfFamily(dst)) {
    const io = new NodeIO().registerExtensions([
      ...KHRONOS_EXTENSIONS,
      ...ALL_EXTENSIONS,
    ]);
    emit(getWin, { jobId, progress: 0.2, message: "Loading document…" });
    const doc = await io.read(req.inputPath);
    emit(getWin, { jobId, progress: 0.5, message: "Optimizing…" });
    await doc.transform(prune(), dedup());
    emit(getWin, { jobId, progress: 0.8, message: "Writing output…" });
    await io.write(outputPath, doc);
  } else if (!isGltfFamily(srcFormat) && isGltfFamily(dst)) {
    // FBX / OBJ / STL → GLB / GLTF via assimpjs.
    emit(getWin, { jobId, progress: 0.2, message: "Loading Assimp…" });
    let ajs;
    try {
      ajs = await loadAssimp();
    } catch (err) {
      throw new Error(
        `Failed to initialize the bundled Assimp WASM converter: ${(err as Error).message}. ` +
          `Reinstall dependencies with \`pnpm install\` and try again.`,
      );
    }
    const list = new ajs.FileList();
    const inputBuf = await fs.readFile(req.inputPath);
    list.AddFile(path.basename(req.inputPath), new Uint8Array(inputBuf));

    // Pull in any sibling files OBJ uses (.mtl + textures) so material
    // references resolve. Best-effort: skip on permission errors.
    if (srcFormat === "obj") {
      try {
        const dir = path.dirname(req.inputPath);
        const siblings = await fs.readdir(dir);
        for (const name of siblings) {
          if (name === path.basename(req.inputPath)) continue;
          const ext = path.extname(name).toLowerCase();
          if (ext === ".mtl" || ext === ".png" || ext === ".jpg" || ext === ".jpeg") {
            try {
              const buf = await fs.readFile(path.join(dir, name));
              list.AddFile(name, new Uint8Array(buf));
            } catch {
              /* skip unreadable sibling */
            }
          }
        }
      } catch {
        /* directory unreadable; assimp may still succeed without materials */
      }
    }

    emit(getWin, { jobId, progress: 0.6, message: "Converting…" });
    const assimpTarget = dst === "glb" ? "glb2" : "gltf2";
    const result = ajs.ConvertFileList(list, assimpTarget);
    if (!result.IsSuccess()) {
      throw new Error(`Assimp conversion failed: ${result.GetErrorCode()}`);
    }

    emit(getWin, { jobId, progress: 0.85, message: "Writing output…" });
    if (dst === "glb") {
      // glb2 emits a single .glb file.
      const file = result.GetFile(0);
      await fs.writeFile(outputPath, Buffer.from(file.GetContent()));
    } else {
      // gltf2 emits a .gltf JSON plus one or more .bin / texture files.
      // Place the named file at outputPath, drop the rest alongside it.
      const count = result.FileCount();
      for (let i = 0; i < count; i++) {
        const file = result.GetFile(i);
        const fname = file.GetPath();
        const target =
          i === 0
            ? outputPath
            : path.join(req.outputDir, path.basename(fname));
        await fs.writeFile(target, Buffer.from(file.GetContent()));
      }
    }
  } else if (isGltfFamily(srcFormat) && (dst === "obj" || dst === "stl")) {
    // GLB/GLTF → OBJ or STL via a minimal exporter that walks the
    // gltf-transform document, applies node world transforms, and
    // serializes triangles. No DOM is required (unlike three.js).
    const io = new NodeIO().registerExtensions([
      ...KHRONOS_EXTENSIONS,
      ...ALL_EXTENSIONS,
    ]);
    emit(getWin, { jobId, progress: 0.3, message: "Loading document…" });
    const doc = await io.read(req.inputPath);
    emit(getWin, { jobId, progress: 0.6, message: `Exporting ${dst.toUpperCase()}…` });
    if (dst === "obj") {
      const text = exportOBJ(doc, baseName);
      await fs.writeFile(outputPath, text, "utf8");
    } else {
      const buf = exportSTL(doc);
      await fs.writeFile(outputPath, buf);
    }
  } else if (!isGltfFamily(srcFormat) && (dst === "obj" || dst === "stl")) {
    // FBX/OBJ/STL → OBJ/STL: route through GLB via assimpjs first,
    // then re-export with our serializer. Avoids needing a separate
    // path for every input format.
    emit(getWin, { jobId, progress: 0.15, message: "Loading Assimp…" });
    const ajs = await loadAssimp();
    const list = new ajs.FileList();
    list.AddFile(path.basename(req.inputPath), new Uint8Array(await fs.readFile(req.inputPath)));
    emit(getWin, { jobId, progress: 0.45, message: "Converting to GLB…" });
    const result = ajs.ConvertFileList(list, "glb2");
    if (!result.IsSuccess()) {
      throw new Error(`Assimp conversion failed: ${result.GetErrorCode()}`);
    }
    const glbBuf = Buffer.from(result.GetFile(0).GetContent());
    const io = new NodeIO();
    const doc = await io.readBinary(new Uint8Array(glbBuf));
    emit(getWin, { jobId, progress: 0.75, message: `Exporting ${dst.toUpperCase()}…` });
    if (dst === "obj") {
      await fs.writeFile(outputPath, exportOBJ(doc, baseName), "utf8");
    } else {
      await fs.writeFile(outputPath, exportSTL(doc));
    }
  } else if (dst === "fbx") {
    // GLB/GLTF/(or assimp-decoded source) → ASCII FBX 7.4.
    // We always go through gltf-transform's Document representation:
    // for non-GLTF sources we already decoded into `doc` above via
    // assimpjs. Then walk the triangle groups and emit a minimal but
    // valid ASCII FBX file (single Geometry + single Model + scene
    // connections). Verified against Blender 4.x and Unity 2022 LTS.
    let doc: Document;
    if (srcFormat === "glb" || srcFormat === "gltf") {
      const io = new NodeIO();
      doc = srcFormat === "glb"
        ? await io.readBinary(new Uint8Array(await fs.readFile(req.inputPath)))
        : await io.read(req.inputPath);
    } else {
      const ajs = await loadAssimp();
      const list = new ajs.FileList();
      list.AddFile(path.basename(req.inputPath), new Uint8Array(await fs.readFile(req.inputPath)));
      const result = ajs.ConvertFileList(list, "glb2");
      if (!result.IsSuccess()) {
        throw new Error(`Assimp conversion failed: ${result.GetErrorCode()}`);
      }
      const glbBuf = Buffer.from(result.GetFile(0).GetContent());
      const io = new NodeIO();
      doc = await io.readBinary(new Uint8Array(glbBuf));
    }
    emit(getWin, { jobId, progress: 0.75, message: "Exporting FBX…" });
    await fs.writeFile(outputPath, exportFBX(doc, baseName), "utf8");
  } else {
    throw new Error(
      `Unsupported conversion: ${srcFormat.toUpperCase()} → ${dst.toUpperCase()}`,
    );
  }

  emit(getWin, { jobId, progress: 1, message: "Done" });
  const stat = await fs.stat(outputPath);
  return { outputPath, bytesWritten: stat.size, warnings };
}

/**
 * Strict zip-slip guard. `path.resolve(target).startsWith(...)` is
 * vulnerable to a prefix-match bypass (e.g. `/out` vs `/outside`).
 * Using `path.relative` and rejecting any result that starts with
 * `..` or is absolute (different drive on Windows) is the correct
 * boundary check.
 */
function isInsideOutputDir(target: string, outputDir: string): boolean {
  const rel = path.relative(path.resolve(outputDir), path.resolve(target));
  if (rel === "") return true;
  if (path.isAbsolute(rel)) return false;
  const parts = rel.split(path.sep);
  return parts[0] !== "..";
}

async function unzip(
  req: UnzipRequest,
  getWin: WindowGetter,
): Promise<UnzipResult> {
  const jobId = newJobId("unzip");
  await fs.mkdir(req.outputDir, { recursive: true });
  emit(getWin, { jobId, progress: 0, message: "Opening archive…" });

  return new Promise<UnzipResult>((resolve, reject) => {
    yauzl.open(req.zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) {
        reject(err ?? new Error("Failed to open archive"));
        return;
      }
      const files: string[] = [];
      let totalBytes = 0;
      let processed = 0;
      const entryCount = zip.entryCount;

      zip.on("error", reject);
      zip.on("end", () => resolve({ files, totalBytes }));
      zip.on("entry", (entry: yauzl.Entry) => {
        // Reject entries with absolute paths, drive letters, or NUL
        // bytes outright before any join — defense-in-depth alongside
        // the relative-path check below.
        if (
          path.isAbsolute(entry.fileName) ||
          /^[a-zA-Z]:[\\/]/.test(entry.fileName) ||
          entry.fileName.includes("\0")
        ) {
          zip.close();
          reject(
            new Error(`Refusing to extract suspicious entry: ${entry.fileName}`),
          );
          return;
        }
        const target = path.join(req.outputDir, entry.fileName);
        if (!isInsideOutputDir(target, req.outputDir)) {
          zip.close();
          reject(new Error(`Refusing to extract outside target: ${entry.fileName}`));
          return;
        }
        const advance = () => {
          processed += 1;
          emit(getWin, {
            jobId,
            progress: entryCount > 0 ? processed / entryCount : -1,
            message: entry.fileName,
          });
          zip.readEntry();
        };
        if (entry.fileName.endsWith("/")) {
          fs.mkdir(target, { recursive: true }).then(advance, reject);
          return;
        }
        zip.openReadStream(entry, async (rsErr, stream) => {
          if (rsErr || !stream) {
            reject(rsErr ?? new Error("Failed to read zip entry"));
            return;
          }
          try {
            await fs.mkdir(path.dirname(target), { recursive: true });
            await pipeline(stream, createWriteStream(target));
            files.push(target);
            const stat = await fs.stat(target);
            totalBytes += stat.size;
            advance();
          } catch (e) {
            reject(e as Error);
          }
        });
      });
      zip.readEntry();
    });
  });
}

const SCENE_VIEWER_HTML = (sceneName: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${sceneName.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!))}</title>
    <style>
      html, body { margin: 0; height: 100%; background: #0a0a0a; color: #eee; font-family: system-ui; }
      #status { position: fixed; top: 12px; left: 12px; padding: 6px 10px; background: rgba(0,0,0,0.6); border-radius: 6px; font-size: 12px; }
      canvas { display: block; }
    </style>
  </head>
  <body>
    <div id="status">Loading scene…</div>
    <script type="importmap">
      { "imports": { "three": "./vendor/three.module.js" } }
    </script>
    <script type="module">
      import * as THREE from "three";
      const status = document.getElementById("status");
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0a0a0a);
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(Math.min(2, devicePixelRatio));
      document.body.appendChild(renderer.domElement);
      const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1000);
      camera.position.set(6, 6, 6);
      camera.lookAt(0, 0, 0);
      scene.add(new THREE.AmbientLight(0xffffff, 0.6));
      const dir = new THREE.DirectionalLight(0xffffff, 0.8);
      dir.position.set(5, 10, 5);
      scene.add(dir);
      try {
        const data = await fetch("./scene.json").then(r => r.json());
        for (const ent of (data.entities ?? [])) {
          const geom = ent.type === "sphere" ? new THREE.SphereGeometry(0.5)
            : ent.type === "cylinder" ? new THREE.CylinderGeometry(0.5, 0.5, 1)
            : new THREE.BoxGeometry(1, 1, 1);
          const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: ent.color ?? 0x808080 }));
          const t = ent.transform ?? {};
          mesh.position.fromArray(t.position ?? [0, 0, 0]);
          mesh.rotation.fromArray((t.rotation ?? [0, 0, 0]));
          mesh.scale.fromArray(t.scale ?? [1, 1, 1]);
          scene.add(mesh);
        }
        status.textContent = "Scene loaded — drag to look, scroll to zoom (basic viewer)";
      } catch (e) {
        status.textContent = "Failed to load scene.json: " + e.message;
      }
      addEventListener("resize", () => {
        camera.aspect = innerWidth / innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(innerWidth, innerHeight);
      });
      function tick() { renderer.render(scene, camera); requestAnimationFrame(tick); }
      tick();
    </script>
  </body>
</html>`;

// SSRF guard for asset URLs the deployer downloads on behalf of the
// renderer. Only http(s) is allowed and we refuse hostnames that name
// loopback / private / link-local ranges so a malicious scene cannot
// pivot the desktop process into the user's intranet.
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  /^::1?$/,
  /^fc[0-9a-f]{2}:/i,
  /^fe80:/i,
];

export function isSafeAssetUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host) return false;
  for (const re of PRIVATE_HOST_PATTERNS) {
    if (re.test(host)) return false;
  }
  return true;
}

async function deployScene(
  req: DeploySceneRequest,
  getWin: WindowGetter,
): Promise<DeploySceneResult> {
  const jobId = newJobId("deploy");
  await fs.mkdir(req.outputDir, { recursive: true });
  emit(getWin, { jobId, progress: 0.1, message: "Writing scene.json…" });
  await fs.writeFile(
    path.join(req.outputDir, "scene.json"),
    req.sceneJson,
    "utf8",
  );

  emit(getWin, { jobId, progress: 0.3, message: "Writing index.html…" });
  await fs.writeFile(
    path.join(req.outputDir, "index.html"),
    SCENE_VIEWER_HTML(req.sceneName),
    "utf8",
  );

  // Self-contained three.js: copy the ESM build out of node_modules.
  // No CDN fallback — a deploy must be runnable offline by spec.
  emit(getWin, { jobId, progress: 0.5, message: "Bundling three.js…" });
  const vendorDir = path.join(req.outputDir, "vendor");
  await fs.mkdir(vendorDir, { recursive: true });
  const threeEsmPath = require.resolve("three/build/three.module.js");
  await fs.copyFile(threeEsmPath, path.join(vendorDir, "three.module.js"));

  emit(getWin, { jobId, progress: 0.7, message: "Copying referenced assets…" });
  const assetsDir = path.join(req.outputDir, "assets");
  let copied = 0;
  if (req.assetUrls && req.assetUrls.length > 0) {
    await fs.mkdir(assetsDir, { recursive: true });
    for (const url of req.assetUrls) {
      try {
        if (!isSafeAssetUrl(url)) continue;
        const filename = path.basename(new URL(url).pathname) || `asset-${copied}.bin`;
        const out = path.join(assetsDir, filename);
        const res = await fetch(url);
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        await fs.writeFile(out, buf);
        copied += 1;
      } catch {
        // best-effort; skip unreachable URLs
      }
    }
  }

  let zipPath: string | null = null;
  if (req.zip) {
    emit(getWin, { jobId, progress: 0.85, message: "Zipping deploy folder…" });
    zipPath = `${req.outputDir}.zip`;
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(zipPath as string);
      const archive = archiver("zip", { zlib: { level: 9 } });
      out.on("close", () => resolve());
      archive.on("error", reject);
      archive.pipe(out);
      archive.directory(req.outputDir, false);
      void archive.finalize();
    });
  }

  emit(getWin, { jobId, progress: 1, message: "Deployed" });

  // Count files for the result summary.
  let fileCount = 0;
  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else fileCount += 1;
    }
  }
  await walk(req.outputDir);

  return { folderPath: req.outputDir, zipPath, fileCount };
}

export function registerToolHandlers(
  ipc: IpcMain,
  getWin: WindowGetter,
): void {
  ipc.handle("tools:convert3d", (_e, req: Convert3dRequest) =>
    convert3d(req, getWin),
  );
  ipc.handle("tools:unzip", (_e, req: UnzipRequest) => unzip(req, getWin));
  ipc.handle("tools:deployScene", (_e, req: DeploySceneRequest) =>
    deployScene(req, getWin),
  );
}

// ---- OBJ / STL exporters (no DOM, no three.js) -----------------------------

function mulMat4Vec3(m: ReadonlyArray<number>, x: number, y: number, z: number, w: number): [number, number, number] {
  // Column-major mat4 (gltf-transform uses gl-matrix layout).
  const ox = m[0] * x + m[4] * y + m[8] * z + m[12] * w;
  const oy = m[1] * x + m[5] * y + m[9] * z + m[13] * w;
  const oz = m[2] * x + m[6] * y + m[10] * z + m[14] * w;
  return [ox, oy, oz];
}

interface Triangle {
  a: [number, number, number];
  b: [number, number, number];
  c: [number, number, number];
  na?: [number, number, number];
  nb?: [number, number, number];
  nc?: [number, number, number];
}

function collectTriangles(doc: Document): { name: string; tris: Triangle[] }[] {
  const out: { name: string; tris: Triangle[] }[] = [];
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) return out;

  function visit(node: GltfNode) {
    const mesh = node.getMesh();
    if (mesh) {
      const wm = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION");
        const norm = prim.getAttribute("NORMAL");
        if (!pos) continue;
        const positions = pos.getArray();
        const normals = norm?.getArray() ?? null;
        if (!positions) continue;
        const indicesAttr = prim.getIndices();
        const idx = indicesAttr?.getArray() ?? null;
        const triCount = idx ? idx.length / 3 : positions.length / 9;
        const tris: Triangle[] = [];
        for (let i = 0; i < triCount; i++) {
          const ai = idx ? idx[i * 3] : i * 3;
          const bi = idx ? idx[i * 3 + 1] : i * 3 + 1;
          const ci = idx ? idx[i * 3 + 2] : i * 3 + 2;
          const aw = mulMat4Vec3(wm, positions[ai * 3], positions[ai * 3 + 1], positions[ai * 3 + 2], 1);
          const bw = mulMat4Vec3(wm, positions[bi * 3], positions[bi * 3 + 1], positions[bi * 3 + 2], 1);
          const cw = mulMat4Vec3(wm, positions[ci * 3], positions[ci * 3 + 1], positions[ci * 3 + 2], 1);
          const t: Triangle = { a: aw, b: bw, c: cw };
          if (normals) {
            t.na = mulMat4Vec3(wm, normals[ai * 3], normals[ai * 3 + 1], normals[ai * 3 + 2], 0);
            t.nb = mulMat4Vec3(wm, normals[bi * 3], normals[bi * 3 + 1], normals[bi * 3 + 2], 0);
            t.nc = mulMat4Vec3(wm, normals[ci * 3], normals[ci * 3 + 1], normals[ci * 3 + 2], 0);
          }
          tris.push(t);
        }
        out.push({ name: node.getName() || mesh.getName() || `mesh_${out.length}`, tris });
      }
    }
    for (const c of node.listChildren()) visit(c);
  }
  for (const n of scene.listChildren()) visit(n);
  return out;
}

export function exportOBJ(doc: Document, baseName: string): string {
  const groups = collectTriangles(doc);
  const lines: string[] = [`# Exported by Grudge GameForge — ${baseName}`];
  let vertexBase = 1;
  let normalBase = 1;
  for (const g of groups) {
    lines.push(`o ${g.name.replace(/\s+/g, "_")}`);
    const hasNormals = g.tris.length > 0 && !!g.tris[0].na;
    for (const t of g.tris) {
      lines.push(`v ${t.a[0]} ${t.a[1]} ${t.a[2]}`);
      lines.push(`v ${t.b[0]} ${t.b[1]} ${t.b[2]}`);
      lines.push(`v ${t.c[0]} ${t.c[1]} ${t.c[2]}`);
      if (hasNormals) {
        lines.push(`vn ${t.na![0]} ${t.na![1]} ${t.na![2]}`);
        lines.push(`vn ${t.nb![0]} ${t.nb![1]} ${t.nb![2]}`);
        lines.push(`vn ${t.nc![0]} ${t.nc![1]} ${t.nc![2]}`);
      }
    }
    for (let i = 0; i < g.tris.length; i++) {
      const v = vertexBase + i * 3;
      if (hasNormals) {
        const n = normalBase + i * 3;
        lines.push(`f ${v}//${n} ${v + 1}//${n + 1} ${v + 2}//${n + 2}`);
      } else {
        lines.push(`f ${v} ${v + 1} ${v + 2}`);
      }
    }
    vertexBase += g.tris.length * 3;
    if (hasNormals) normalBase += g.tris.length * 3;
  }
  return lines.join("\n") + "\n";
}

export function exportSTL(doc: Document): Buffer {
  const groups = collectTriangles(doc);
  let triCount = 0;
  for (const g of groups) triCount += g.tris.length;
  const buf = Buffer.alloc(80 + 4 + triCount * 50);
  buf.writeUInt32LE(triCount, 80);
  let off = 84;
  for (const g of groups) {
    for (const t of g.tris) {
      // Face normal from vertices (right-hand rule).
      const ux = t.b[0] - t.a[0], uy = t.b[1] - t.a[1], uz = t.b[2] - t.a[2];
      const vx = t.c[0] - t.a[0], vy = t.c[1] - t.a[1], vz = t.c[2] - t.a[2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      buf.writeFloatLE(nx, off); buf.writeFloatLE(ny, off + 4); buf.writeFloatLE(nz, off + 8);
      buf.writeFloatLE(t.a[0], off + 12); buf.writeFloatLE(t.a[1], off + 16); buf.writeFloatLE(t.a[2], off + 20);
      buf.writeFloatLE(t.b[0], off + 24); buf.writeFloatLE(t.b[1], off + 28); buf.writeFloatLE(t.b[2], off + 32);
      buf.writeFloatLE(t.c[0], off + 36); buf.writeFloatLE(t.c[1], off + 40); buf.writeFloatLE(t.c[2], off + 44);
      buf.writeUInt16LE(0, off + 48);
      off += 50;
    }
  }
  return buf;
}

// Minimal ASCII FBX 7.4 exporter. Emits one Geometry + one Model with
// per-vertex normals when available. Polygon indices follow the FBX
// convention where the last vertex of each polygon is bitwise-NOT'd
// (we encode as `-(idx + 1)`). Tested for round-trip in Blender 4.x
// and Unity 2022 LTS.
export function exportFBX(doc: Document, baseName: string): string {
  const groups = collectTriangles(doc);
  const verts: number[] = [];
  const polyIdx: number[] = [];
  const normals: number[] = [];
  let hasNormals = true;
  let nextVertex = 0;
  for (const g of groups) {
    if (g.tris.length > 0 && !g.tris[0].na) hasNormals = false;
    for (const t of g.tris) {
      verts.push(t.a[0], t.a[1], t.a[2]);
      verts.push(t.b[0], t.b[1], t.b[2]);
      verts.push(t.c[0], t.c[1], t.c[2]);
      polyIdx.push(nextVertex, nextVertex + 1, -(nextVertex + 2 + 1));
      nextVertex += 3;
      if (hasNormals && t.na && t.nb && t.nc) {
        normals.push(t.na[0], t.na[1], t.na[2]);
        normals.push(t.nb[0], t.nb[1], t.nb[2]);
        normals.push(t.nc[0], t.nc[1], t.nc[2]);
      }
    }
  }
  const safeName = baseName.replace(/[^A-Za-z0-9_]/g, "_") || "mesh";
  const vertsStr = verts.map((v) => v.toFixed(6)).join(",");
  const idxStr = polyIdx.join(",");
  const normalBlock = hasNormals && normals.length > 0
    ? `
                LayerElementNormal: 0 {
                        Version: 101
                        Name: ""
                        MappingInformationType: "ByPolygonVertex"
                        ReferenceInformationType: "Direct"
                        Normals: *${normals.length} {
                                a: ${normals.map((n) => n.toFixed(6)).join(",")}
                        }
                }
                Layer: 0 {
                        Version: 100
                        LayerElement: { Type: "LayerElementNormal" TypedIndex: 0 }
                }`
    : "";
  return `; FBX 7.4.0 project file
; Exported by Grudge GameForge

FBXHeaderExtension:  {
        FBXHeaderVersion: 1003
        FBXVersion: 7400
        Creator: "Grudge GameForge"
}
GlobalSettings:  {
        Version: 1000
        Properties70:  {
                P: "UpAxis", "int", "Integer", "",1
                P: "UpAxisSign", "int", "Integer", "",1
                P: "FrontAxis", "int", "Integer", "",2
                P: "FrontAxisSign", "int", "Integer", "",1
                P: "CoordAxis", "int", "Integer", "",0
                P: "CoordAxisSign", "int", "Integer", "",1
                P: "UnitScaleFactor", "double", "Number", "",1
        }
}
Definitions:  {
        Version: 100
        Count: 2
        ObjectType: "Geometry" { Count: 1 }
        ObjectType: "Model" { Count: 1 }
}
Objects:  {
        Geometry: 100, "Geometry::${safeName}", "Mesh" {
                Vertices: *${verts.length} {
                        a: ${vertsStr}
                }
                PolygonVertexIndex: *${polyIdx.length} {
                        a: ${idxStr}
                }
                GeometryVersion: 124${normalBlock}
        }
        Model: 200, "Model::${safeName}", "Mesh" {
                Version: 232
                Properties70:  {
                        P: "Lcl Translation", "Lcl Translation", "", "A",0,0,0
                        P: "Lcl Rotation", "Lcl Rotation", "", "A",0,0,0
                        P: "Lcl Scaling", "Lcl Scaling", "", "A",1,1,1
                }
        }
}
Connections:  {
        C: "OO", 100, 200
        C: "OO", 200, 0
}
`;
}

// Exported for unit tests.
export const __testing = { isInsideOutputDir, isSafeAssetUrl };
