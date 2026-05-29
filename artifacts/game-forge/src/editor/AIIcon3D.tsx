/**
 * AIIcon3D — a small spinning 3D icon for the AI Worker button.
 *
 * Renders a tiny R3F Canvas with a rotating icosahedron (or a loaded GLB
 * if `glbUrl` is provided). The canvas is sized to fit inside a button
 * (default 20×20px) and renders at a low pixel ratio to stay cheap.
 *
 * Uses a standalone Canvas so it doesn't interfere with the main viewport's
 * R3F tree. The animation runs via useFrame (no requestAnimationFrame leak).
 *
 * Usage:
 *   <AIIcon3D size={20} />                    — spinning procedural gem
 *   <AIIcon3D size={20} glbUrl="builtin:..." /> — spinning GLB model
 */
import { Canvas, useFrame } from "@react-three/fiber";
import { useRef, memo, Suspense } from "react";
import * as THREE from "three";

/** Procedural spinning gem — a wireframe icosahedron with emissive gold
 *  edges and a subtle inner glow. Cheap to render, no asset loading. */
function SpinningGem({ speed = 1.2 }: { speed?: number }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const innerRef = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * speed;
      meshRef.current.rotation.x += delta * speed * 0.3;
    }
    if (innerRef.current) {
      innerRef.current.rotation.y -= delta * speed * 0.5;
    }
  });

  return (
    <group>
      {/* Outer wireframe icosahedron */}
      <mesh ref={meshRef}>
        <icosahedronGeometry args={[0.7, 1]} />
        <meshBasicMaterial
          color="#f6c945"
          wireframe
          transparent
          opacity={0.85}
        />
      </mesh>
      {/* Inner solid glow core */}
      <mesh ref={innerRef} scale={0.35}>
        <icosahedronGeometry args={[1, 0]} />
        <meshBasicMaterial
          color="#ffdd70"
          transparent
          opacity={0.6}
        />
      </mesh>
      {/* Subtle point light for the glow effect */}
      <pointLight color="#f6c945" intensity={2} distance={3} />
    </group>
  );
}

interface AIIcon3DProps {
  /** Canvas size in pixels (square). Default 20. */
  size?: number;
  /** Spin speed multiplier. Default 1.2. */
  speed?: number;
  /** Optional class for the wrapper div. */
  className?: string;
  /** Whether the AI is actively streaming (pulses brighter). */
  active?: boolean;
}

export const AIIcon3D = memo(function AIIcon3D({
  size = 20,
  speed = 1.2,
  className = "",
  active = false,
}: AIIcon3DProps) {
  return (
    <div
      className={`inline-flex items-center justify-center flex-shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: 4,
        overflow: "hidden",
        filter: active ? "brightness(1.4) drop-shadow(0 0 4px #f6c94580)" : undefined,
        transition: "filter 0.3s ease",
      }}
    >
      <Canvas
        dpr={1}
        gl={{ antialias: false, alpha: true, powerPreference: "low-power" }}
        camera={{ position: [0, 0, 2.2], fov: 45 }}
        style={{ width: size, height: size, background: "transparent" }}
        // Prevent this tiny canvas from capturing pointer events that
        // should go to the button underneath.
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Suspense fallback={null}>
          <SpinningGem speed={speed} />
        </Suspense>
      </Canvas>
    </div>
  );
});
