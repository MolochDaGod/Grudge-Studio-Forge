import { describe, it, expect, beforeEach } from "vitest";
import { useAuth } from "@/store/auth";
import { cloud, path } from "@/lib/cloud/puterCloud";

describe("puterCloud guest no-op", () => {
  beforeEach(() => {
    useAuth.getState().reset();
    useAuth.getState().setGuest({ id: "g", name: "guest" });
  });

  it("isAvailable() is false for guests", () => {
    expect(cloud.isAvailable()).toBe(false);
  });

  it("kv.get returns ok:false reason 'guest'", async () => {
    const r = await cloud.kv.get("anything");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("guest");
  });

  it("kv.set / kv.delete also no-op with guest reason", async () => {
    const a = await cloud.kv.set("k", "v");
    const b = await cloud.kv.delete("k");
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    if (!a.ok) expect(a.reason).toBe("guest");
    if (!b.ok) expect(b.reason).toBe("guest");
  });

  it("fs.read / fs.write no-op for guests", async () => {
    const r = await cloud.fs.read("Grudge/x.json");
    const w = await cloud.fs.write("Grudge/x.json", "data");
    expect(r.ok).toBe(false);
    expect(w.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("guest");
  });
});

describe("puterCloud path()", () => {
  it("joins segments with slashes and trims surrounding ones", () => {
    expect(path("Grudge", "projects", "42")).toBe("Grudge/projects/42");
    expect(path("/Grudge/", "/projects/", "42/")).toBe("Grudge/projects/42");
    expect(path("a", "", "b")).toBe("a/b");
  });
});
