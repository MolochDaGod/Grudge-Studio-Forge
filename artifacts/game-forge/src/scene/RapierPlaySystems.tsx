/**
 * Play-mode Rapier extras that need a world tick: buoyancy in Water overlaps.
 */
import { useAfterPhysicsStep, useRapier } from "@react-three/rapier";
import { useRef } from "react";
import { applyBuoyancy, type RapierBodyLike } from "@/lib/rapierPlay";
import { getPlaySession } from "./playSession";
import { DEFAULT_GRAVITY } from "@workspace/scene-schema";
import { useEditor } from "@/store/editor";
import type { RapierRigidBody } from "@react-three/rapier";
import type * as THREE from "three";

export function RapierPlaySystems({
  bodyRefs,
}: {
  bodyRefs: React.MutableRefObject<Map<string, RapierRigidBody | THREE.Group>>;
}) {
  const { world } = useRapier();
  const gravityY = useEditor((s) => s.sceneData.environment.gravity?.[1] ?? DEFAULT_GRAVITY[1]);
  const scratch = useRef(0);
  scratch.current = gravityY as number;

  useAfterPhysicsStep(() => {
    void world;
    const session = getPlaySession();
    if (session.waterOverlaps.size === 0) return;
    const g = scratch.current;
    for (const [id, n] of session.waterOverlaps) {
      if (n <= 0) continue;
      const b = bodyRefs.current.get(id);
      if (!b || !("translation" in b)) continue;
      const body = b as unknown as RapierBodyLike;
      if (body.bodyType?.() === 2) continue; /* CCT player — climb/swim uses controller */
      applyBuoyancy(body, g, Math.min(1, n));
      const v = body.linvel?.();
      if (v) body.setLinvel?.({ x: v.x * 0.92, y: v.y, z: v.z * 0.92 }, true);
    }
  });

  return null;
}
