import { describe, expect, it } from "vitest";
import { defs, handlers, destructiveToolNames } from "../index";
import { UI_KITS, UI_LAYERS, UI_KIT_SITE } from "@/lib/uiKitCatalog";

describe("ui kit tools", () => {
  it("exports matching defs/handlers", () => {
    expect(defs.map((d) => d.name).sort()).toEqual(Object.keys(handlers).sort());
  });

  it("lists kits from ui.grudge-studio.com catalog", async () => {
    const r = await handlers.list_ui_kits!({});
    expect(r.ok).toBe(true);
    const data = r.data as { site: string; kits: Array<{ theme: string }> };
    expect(data.site).toBe(UI_KIT_SITE);
    expect(data.kits.length).toBe(UI_KITS.length);
    expect(data.kits.map((k) => k.theme).sort()).toEqual(
      ["cyberpunk", "fantasy", "fps", "rpg"].sort(),
    );
  });

  it("lists professional HUD layers", async () => {
    const r = await handlers.list_ui_layers!({});
    expect(r.ok).toBe(true);
    const data = r.data as { layers: unknown[] };
    expect(data.layers.length).toBe(UI_LAYERS.length);
  });

  it("marks apply_ui_kit destructive", () => {
    expect(destructiveToolNames).toContain("apply_ui_kit");
  });

  it("browse_ui_kit returns site guidance", async () => {
    const r = await handlers.browse_ui_kit!({ theme: "fantasy" });
    expect(r.ok).toBe(true);
    const data = r.data as { site: string; kit: { theme: string }; guidance: string[] };
    expect(data.site).toBe(UI_KIT_SITE);
    expect(data.kit.theme).toBe("fantasy");
    expect(data.guidance.length).toBeGreaterThan(0);
  });
});
