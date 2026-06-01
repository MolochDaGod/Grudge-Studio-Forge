import { describe, it, expect } from "vitest";
import { classifyDroppedFile, isModelKind } from "./fileKind";

function f(name: string): File {
  return new File([new Uint8Array([0])], name);
}

describe("classifyDroppedFile", () => {
  it("classifies model formats including fbx/stl", () => {
    expect(classifyDroppedFile(f("a.glb"))).toBe("glb");
    expect(classifyDroppedFile(f("a.gltf"))).toBe("gltf");
    expect(classifyDroppedFile(f("a.obj"))).toBe("obj");
    expect(classifyDroppedFile(f("a.fbx"))).toBe("fbx");
    expect(classifyDroppedFile(f("a.stl"))).toBe("stl");
    expect(classifyDroppedFile(f("A.FBX"))).toBe("fbx");
  });

  it("classifies images, audio, zip, and scene json", () => {
    expect(classifyDroppedFile(f("a.png"))).toBe("image");
    expect(classifyDroppedFile(f("a.mp3"))).toBe("audio");
    expect(classifyDroppedFile(f("pack.zip"))).toBe("zip");
    expect(classifyDroppedFile(f("scene.gfscene.json"))).toBe("scene-json");
  });

  it("returns null for unsupported extensions", () => {
    expect(classifyDroppedFile(f("notes.txt"))).toBeNull();
    expect(classifyDroppedFile(f("model.blend"))).toBeNull();
  });

  it("isModelKind covers every transcodable model kind", () => {
    for (const k of ["glb", "gltf", "obj", "fbx", "stl"] as const) {
      expect(isModelKind(k)).toBe(true);
    }
    for (const k of ["image", "audio", "zip", "scene-json", null] as const) {
      expect(isModelKind(k)).toBe(false);
    }
  });
});
