/**
 * GrudgeBabylonLoader — Forge SceneData → Babylon.js scene hydrator.
 *
 * Reads the engine-agnostic `.gfscene.json` format produced by the
 * Grudge GameForge editor (Three.js + R3F) and spawns the equivalent
 * Babylon.js scene graph: meshes, GLB models, lights, physics bodies,
 * fog, sky, camera controllers, and parent-child hierarchy.
 *
 * Usage:
 *   const loader = new GrudgeBabylonLoader(engine, canvas);
 *   await loader.load(sceneData);       // SceneData from JSON
 *   engine.runRenderLoop(() => loader.scene.render());
 */
import {
  Engine,
  Scene,
  Vector3,
  Color3,
  Color4,
  ArcRotateCamera,
  FreeCamera,
  FollowCamera,
  HemisphericLight,
  DirectionalLight,
  PointLight,
  SpotLight,
  MeshBuilder,
  StandardMaterial,
  PBRMaterial,
  SceneLoader,
  TransformNode,
  AbstractMesh,
  type Mesh,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";

import type {
  SceneData,
  SceneEntity,
  Environment,
  Vec3,
  MaterialComponent,
} from "@workspace/scene-schema";
import {
  DEFAULT_GRAVITY,
  DEFAULT_ENV,
  DEFAULT_FOG,
  resolveMaterialDefaults,
} from "@workspace/scene-schema";

// ── Types ────────────────────────────────────────────────────────

export interface LoaderOptions {
  /** Base URL for resolving `builtin:` model keys. When omitted, builtin
   *  models are skipped (the Forge editor bundles them via Vite; standalone
   *  Babylon consumers must host them somewhere). */
  builtinBaseUrl?: string;
  /** Base URL for the Forge API server (for resolving `/api/` asset proxy
   *  URLs). Falls back to `""` (same origin). */
  apiBaseUrl?: string;
  /** Enable Havok physics. When false, physics components are ignored.
   *  Default true — caller must have loaded `@babylonjs/havok` and passed
   *  the HavokPlugin to the scene before calling `load()`, OR set this
   *  to false. */
  enablePhysics?: boolean;
  /** Callback for resolved entity id → Babylon node mapping. Useful for
   *  post-load scripting / gameplay wiring. */
  onEntityCreated?: (entityId: string, node: TransformNode | AbstractMesh) => void;
}

// ── Helpers ──────────────────────────────────────────────────────

function toVec3(v: Vec3 | undefined, fallback: Vec3 = [0, 0, 0]): Vector3 {
  const [x, y, z] = v ?? fallback;
  return new Vector3(x, y, z);
}

function toColor3(hex: string | undefined, fallback = "#ffffff"): Color3 {
  return Color3.FromHexString(hex ?? fallback);
}

function toColor4(hex: string | undefined, alpha = 1, fallback = "#000000"): Color4 {
  const c = Color3.FromHexString(hex ?? fallback);
  return new Color4(c.r, c.g, c.b, alpha);
}

/** Degrees ← euler radians (Forge stores radians, Babylon uses radians
 *  for rotation too, but we need to convert the Forge XYZ euler order to
 *  Babylon's convention). */
function toRotation(v: Vec3 | undefined): Vector3 {
  const [x, y, z] = v ?? [0, 0, 0];
  return new Vector3(x, y, z);
}

/** Resolve a model URL from the SceneData format. Handles:
 *    - `builtin:foo`  → `{builtinBaseUrl}/foo.glb`
 *    - `/api/...`     → `{apiBaseUrl}/api/...`
 *    - absolute https → pass through
 */
function resolveModelUrl(
  raw: string,
  opts: LoaderOptions,
): string | null {
  if (!raw) return null;
  if (raw.startsWith("builtin:")) {
    if (!opts.builtinBaseUrl) return null;
    const key = raw.slice("builtin:".length);
    return `${opts.builtinBaseUrl.replace(/\/+$/, "")}/${key}.glb`;
  }
  if (raw.startsWith("/api/")) {
    return `${opts.apiBaseUrl ?? ""}${raw}`;
  }
  return raw;
}

// ── Loader ───────────────────────────────────────────────────────

export class GrudgeBabylonLoader {
  readonly scene: Scene;
  private opts: Required<LoaderOptions>;
  private entityMap = new Map<string, TransformNode | AbstractMesh>();

  constructor(
    private engine: Engine,
    private canvas: HTMLCanvasElement,
    opts: LoaderOptions = {},
  ) {
    this.scene = new Scene(engine);
    this.opts = {
      builtinBaseUrl: opts.builtinBaseUrl ?? "",
      apiBaseUrl: opts.apiBaseUrl ?? "",
      enablePhysics: opts.enablePhysics ?? false,
      onEntityCreated: opts.onEntityCreated ?? (() => {}),
    };
  }

  /** Load a SceneData JSON blob into the Babylon scene. */
  async load(data: SceneData): Promise<void> {
    const env = { ...DEFAULT_ENV, ...data.environment };

    this.setupEnvironment(env);
    this.setupCamera(env);

    // First pass: create all entities (primitives + empties + lights)
    // so parent references resolve. GLB loads are async and run in
    // the second pass.
    const glbQueue: Array<{ entity: SceneEntity; node: TransformNode }> = [];

    for (const entity of data.entities) {
      const node = this.createEntity(entity);
      this.entityMap.set(entity.id, node);
      this.opts.onEntityCreated(entity.id, node);

      if (entity.type === "model" && entity.model?.url) {
        glbQueue.push({ entity, node });
      }
    }

    // Wire parent-child hierarchy
    for (const entity of data.entities) {
      if (entity.parentId) {
        const child = this.entityMap.get(entity.id);
        const parent = this.entityMap.get(entity.parentId);
        if (child && parent) child.parent = parent;
      }
    }

    // Second pass: load GLB models in parallel
    await Promise.allSettled(
      glbQueue.map(({ entity, node }) => this.loadModel(entity, node)),
    );

    // Ground plane (if no entity named "ground" exists)
    const hasGround = data.entities.some(
      (e) => e.name.toLowerCase().includes("ground") || e.type === "plane",
    );
    if (!hasGround) {
      const ground = MeshBuilder.CreateGround(
        "__ground",
        { width: 30, height: 30 },
        this.scene,
      );
      const gMat = new StandardMaterial("__groundMat", this.scene);
      gMat.diffuseColor = toColor3(env.groundColor, "#1a1a2e");
      gMat.specularColor = Color3.Black();
      ground.material = gMat;
      ground.position.y = -0.01;
    }
  }

  /** Get a loaded entity node by its SceneData id. */
  getNode(entityId: string): TransformNode | AbstractMesh | undefined {
    return this.entityMap.get(entityId);
  }

  // ── Environment ──────────────────────────────────────────────

  private setupEnvironment(env: Environment): void {
    // Sky / clear color
    this.scene.clearColor = toColor4(env.skyColor, 1, "#0a0a14");

    // Ambient
    const ambient = new HemisphericLight(
      "__ambient",
      new Vector3(0, 1, 0),
      this.scene,
    );
    ambient.intensity = env.ambientIntensity ?? 0.4;
    ambient.diffuse = Color3.White();
    ambient.groundColor = toColor3(env.groundColor, "#1a1a2e");

    // Directional sun
    const sun = new DirectionalLight(
      "__sun",
      new Vector3(-0.5, -1, -0.3).normalize(),
      this.scene,
    );
    sun.intensity = env.sunIntensity ?? 1.2;
    sun.diffuse = new Color3(1, 0.95, 0.85);

    // Fog
    const fog = env.fog;
    if (fog) {
      this.scene.fogMode = Scene.FOGMODE_LINEAR;
      this.scene.fogStart = fog.near ?? DEFAULT_FOG.near;
      this.scene.fogEnd = fog.far ?? DEFAULT_FOG.far;
      this.scene.fogColor = toColor3(fog.color ?? env.skyColor, "#0a0a14");
    }

    // Gravity (for future physics integration)
    const grav = env.gravity ?? DEFAULT_GRAVITY;
    this.scene.gravity = new Vector3(grav[0], grav[1], grav[2]);
  }

  // ── Camera ───────────────────────────────────────────────────

  private setupCamera(env: Environment): void {
    const mode = env.cameraMode ?? "editor";

    if (mode === "firstPerson") {
      const cam = new FreeCamera(
        "__camera",
        new Vector3(0, 2, -5),
        this.scene,
      );
      cam.setTarget(Vector3.Zero());
      cam.attachControl(this.canvas, true);
      cam.speed = env.playerMoveSpeed ?? 6;
      cam.angularSensibility = 1 / (env.mouseSensitivity ?? 0.0025);
      cam.keysUp = [87];    // W
      cam.keysDown = [83];  // S
      cam.keysLeft = [65];  // A
      cam.keysRight = [68]; // D
    } else if (mode === "thirdPerson") {
      const cam = new FollowCamera(
        "__camera",
        new Vector3(0, 8, -12),
        this.scene,
      );
      cam.radius = 10;
      cam.heightOffset = 5;
      cam.rotationOffset = 180;
      cam.cameraAcceleration = 0.05;
      cam.maxCameraSpeed = 10;
      cam.attachControl(true);
      // The target will be wired once the player entity loads
      // (see locateTarget at end of load())
    } else {
      // editor / rts → orbit camera
      const cam = new ArcRotateCamera(
        "__camera",
        -Math.PI / 2,
        Math.PI / 3,
        15,
        new Vector3(0, 1, 0),
        this.scene,
      );
      cam.attachControl(this.canvas, true);
      cam.lowerRadiusLimit = 2;
      cam.upperRadiusLimit = 100;
      cam.wheelPrecision = 20;
    }
  }

  // ── Entity creation ──────────────────────────────────────────

  private createEntity(entity: SceneEntity): TransformNode | AbstractMesh {
    const pos = toVec3(entity.transform.position);
    const rot = toRotation(entity.transform.rotation);
    const scl = toVec3(entity.transform.scale, [1, 1, 1]);

    let node: TransformNode | AbstractMesh;

    switch (entity.type) {
      case "box":
        node = this.createPrimitive(entity, "box");
        break;
      case "sphere":
        node = this.createPrimitive(entity, "sphere");
        break;
      case "cylinder":
        node = this.createPrimitive(entity, "cylinder");
        break;
      case "plane":
        node = this.createPrimitive(entity, "plane");
        break;
      case "light":
        node = this.createLight(entity);
        break;
      case "model":
        // Placeholder transform — GLB loaded async in second pass
        node = new TransformNode(entity.name, this.scene);
        break;
      default:
        // empty, cloth, flag, particles, camera → transform node
        node = new TransformNode(entity.name, this.scene);
        break;
    }

    node.position = pos;
    node.rotation = rot;
    node.scaling = scl;
    node.metadata = {
      grudgeId: entity.id,
      grudgeType: entity.type,
      layer: entity.layer,
      surface: entity.surface,
      controllerKind: entity.controllerKind,
      behavior: entity.behavior,
    };

    return node;
  }

  // ── Primitives ───────────────────────────────────────────────

  private createPrimitive(
    entity: SceneEntity,
    shape: "box" | "sphere" | "cylinder" | "plane",
  ): Mesh {
    let mesh: Mesh;
    switch (shape) {
      case "box":
        mesh = MeshBuilder.CreateBox(entity.name, { size: 1 }, this.scene);
        break;
      case "sphere":
        mesh = MeshBuilder.CreateSphere(entity.name, { diameter: 1, segments: 16 }, this.scene);
        break;
      case "cylinder":
        mesh = MeshBuilder.CreateCylinder(entity.name, { diameter: 1, height: 1, tessellation: 16 }, this.scene);
        break;
      case "plane":
        mesh = MeshBuilder.CreateGround(entity.name, { width: 1, height: 1 }, this.scene);
        break;
    }

    this.applyMaterial(mesh, entity.material);
    return mesh;
  }

  // ── Materials ────────────────────────────────────────────────

  private applyMaterial(mesh: Mesh, matComp: MaterialComponent | undefined): void {
    const resolved = resolveMaterialDefaults(matComp);
    const mat = new PBRMaterial(`${mesh.name}_mat`, this.scene);

    mat.albedoColor = toColor3(matComp?.color, "#888888");
    mat.metallic = matComp?.metalness ?? 0;
    mat.roughness = matComp?.roughness ?? 0.5;

    if (matComp?.emissive) {
      mat.emissiveColor = toColor3(matComp.emissive);
      mat.emissiveIntensity = 1;
    }

    if (resolved.opacity < 1) {
      mat.alpha = resolved.opacity;
      mat.transparencyMode = PBRMaterial.MATERIAL_ALPHABLEND;
    }

    mesh.material = mat;
  }

  // ── Lights ───────────────────────────────────────────────────

  private createLight(entity: SceneEntity): TransformNode {
    const lc = entity.light;
    const color = toColor3(lc?.color, "#ffffff");
    const intensity = lc?.intensity ?? 4;
    const wrapper = new TransformNode(entity.name, this.scene);

    switch (lc?.kind) {
      case "directional": {
        const dl = new DirectionalLight(
          `${entity.name}_dl`,
          new Vector3(0, -1, 0),
          this.scene,
        );
        dl.diffuse = color;
        dl.intensity = intensity;
        dl.parent = wrapper;
        break;
      }
      case "spot": {
        const sl = new SpotLight(
          `${entity.name}_sl`,
          Vector3.Zero(),
          new Vector3(0, -1, 0),
          Math.PI / 4,
          2,
          this.scene,
        );
        sl.diffuse = color;
        sl.intensity = intensity;
        sl.parent = wrapper;
        break;
      }
      default: {
        // point light
        const pl = new PointLight(
          `${entity.name}_pl`,
          Vector3.Zero(),
          this.scene,
        );
        pl.diffuse = color;
        pl.intensity = intensity;
        pl.range = lc?.distance ?? 20;
        pl.parent = wrapper;
        break;
      }
    }
    return wrapper;
  }

  // ── GLB model loading ────────────────────────────────────────

  private async loadModel(
    entity: SceneEntity,
    parent: TransformNode,
  ): Promise<void> {
    const url = resolveModelUrl(entity.model!.url!, this.opts);
    if (!url) return;

    try {
      const result = await SceneLoader.ImportMeshAsync(
        "",
        "",
        url,
        this.scene,
      );

      // Reparent all root meshes under the entity's transform node
      for (const mesh of result.meshes) {
        if (!mesh.parent) {
          mesh.parent = parent;
        }
      }

      // Apply tint
      if (entity.model?.tint) {
        const tint = toColor3(entity.model.tint);
        for (const mesh of result.meshes) {
          if (mesh.material && "albedoColor" in mesh.material) {
            (mesh.material as PBRMaterial).albedoColor = tint;
          } else if (mesh.material && "diffuseColor" in mesh.material) {
            (mesh.material as StandardMaterial).diffuseColor = tint;
          }
        }
      }

      // Play animation clip
      if (entity.model?.clip && result.animationGroups.length > 0) {
        const target = result.animationGroups.find(
          (ag) => ag.name === entity.model!.clip,
        ) ?? result.animationGroups[0];
        target?.start(true);
      } else if (result.animationGroups.length > 0) {
        // Auto-play first clip (matches Forge behavior)
        result.animationGroups[0]?.start(true);
      }

      // Apply yaw offset (Forge stores this for models authored facing +Z)
      if (entity.model?.yawOffset) {
        parent.rotation.y += entity.model.yawOffset;
      }

      // Wire FollowCamera target for player entities
      if (
        entity.controllerKind === "thirdPerson" ||
        entity.controllerKind === "firstPerson"
      ) {
        const cam = this.scene.activeCamera;
        if (cam instanceof FollowCamera) {
          // FollowCamera.lockedTarget accepts AbstractMesh — find the
          // first mesh child under this transform to use as the target.
          const targetMesh = result.meshes.find((m) => m.getTotalVertices() > 0) ?? result.meshes[0];
          if (targetMesh) cam.lockedTarget = targetMesh;
        }
      }
    } catch (err) {
      console.warn(
        `[babylon-runtime] Failed to load model for "${entity.name}": ${url}`,
        err,
      );
    }
  }
}
