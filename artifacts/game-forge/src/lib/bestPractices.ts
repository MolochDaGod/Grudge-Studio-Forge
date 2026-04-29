export type BestPracticeContext =
  | "viewport"
  | "weapon"
  | "item"
  | "enemy"
  | "quest"
  | "model"
  | "texture"
  | "hdri"
  | "project-asset";

export type BestPractice = {
  title: string;
  detail: string;
};

const BEST_PRACTICES: Record<BestPracticeContext, BestPractice[]> = {
  viewport: [
    {
      title: "Keep entity count under ~200 for 60 fps",
      detail:
        "Each entity adds a draw call and a physics body. Use prefabs and instancing for repeated objects (trees, props) instead of duplicating entities.",
    },
    {
      title: "Bake static lights — point lights are expensive",
      detail:
        "Use one directional sun + a few point lights for hero objects. Disable shadow casting on small props.",
    },
    {
      title: "Use the editor camera in play mode for debugging",
      detail:
        "Set Play-Mode Camera to 'Editor (orbit)' in the Inspector to fly around while gameplay runs — great for inspecting physics issues.",
    },
    {
      title: "P toggles play, Esc stops, Space is yours (jump)",
      detail:
        "The editor never binds Space, so user scripts can use it as the jump key. Use F to focus selection, W/E/R to switch translate/rotate/scale gizmos.",
    },
  ],
  weapon: [
    {
      title: "Tier scales damage AND drop rarity",
      detail:
        "T1 = common, T5 = legendary. Keep tier-1 base damage 5–10, tier-5 base damage 60–120. Avoid placing T4+ weapons on starter prefabs.",
    },
    {
      title: "Pair on-hit effects with a cooldown",
      detail:
        "Effects like burn / freeze / knockback should have a per-target cooldown, otherwise they stunlock — bad UX. 0.5–1.0 s is the usual range.",
    },
    {
      title: "Spawn weapons as pickups, not as entity children",
      detail:
        "Use the Items tab for inventory-style pickups; use Weapons only for the held/equipped slot of an enemy or player prefab.",
    },
  ],
  item: [
    {
      title: "Stackable items need a stack cap",
      detail:
        "Set max stack size in the inspector. Potions usually 5–20, materials 99, key items 1.",
    },
    {
      title: "Tier 3+ items should NOT spawn in starter zones",
      detail:
        "Gate higher-tier loot behind boss kills or quest completions to preserve progression.",
    },
  ],
  enemy: [
    {
      title: "Enemies need a spawn point, not raw entity placement",
      detail:
        "Use a SpawnPoint prefab so enemies respawn after death or zone reload. Direct entity placement only respawns on full project reload.",
    },
    {
      title: "Balance HP vs damage by tier",
      detail:
        "T1 enemy: 30 HP, 5 dmg. T5 boss: 1500 HP, 60 dmg. Keep TTK (time-to-kill) around 4–8 s for melee, 2–4 s for ranged.",
    },
    {
      title: "Add a Player tag to whatever the enemy AI should chase",
      detail:
        "AI scripts use the 'player' tag to find targets. The starter Blake prefab sets this automatically; custom heroes need it set in the Inspector.",
    },
  ],
  quest: [
    {
      title: "Quests need both a giver and a turn-in entity",
      detail:
        "Even the same NPC can do both, but the script needs explicit start/complete IDs — don't rely on 'first NPC found'.",
    },
    {
      title: "Reward XP scales with player level, not quest tier",
      detail:
        "Use the catalogue's xpReward as a multiplier of (player_level + 1). Hard-coding XP makes late-game quests feel useless.",
    },
  ],
  model: [
    {
      title: "Use builtin: URLs for starter models — they get cached",
      detail:
        "Models prefixed builtin:* are warmed up by the asset preloader and cached across scene reloads. External glTF URLs re-fetch every time.",
    },
    {
      title: "Check the polygon count before spawning many copies",
      detail:
        "A 50k-poly hero model is fine once; spawning 30 of them tanks the framerate. For prop counts > 10, prefer LOD or instancing.",
    },
    {
      title: "Embed textures in the .glb when possible",
      detail:
        "External texture references mean an extra HTTP round-trip per material. Re-export from Blender with 'Embed images' for single-file delivery.",
    },
    {
      title: "Center the pivot in your modelling tool",
      detail:
        "If your model spawns offset from its position, the pivot wasn't at origin in Blender. Apply transforms before exporting.",
    },
  ],
  texture: [
    {
      title: "Pair albedo + normal + roughness for PBR",
      detail:
        "A single colour map looks flat. Import all three from the Poly Haven texture and assign them in the Inspector's material section.",
    },
    {
      title: "1K is enough for most surfaces",
      detail:
        "2K only when the texture covers a hero asset on screen. 4K textures are 16x the memory of 1K and rarely worth it for in-game props.",
    },
    {
      title: "Use UV repeat for tileable surfaces",
      detail:
        "Brick, wood, ground textures should tile (set UV repeat 4×4 or 8×8 on a plane). Don't stretch a single 1K image across a 100m floor.",
    },
  ],
  hdri: [
    {
      title: "1K HDRIs are fine for environment lighting",
      detail:
        "The HDRI provides indirect light + reflections. 4K is only useful when the sky is visible and high-res is part of the look.",
    },
    {
      title: "Lower the Ambient slider when an HDRI is active",
      detail:
        "HDRIs already provide ambient. Set Ambient to 0.1–0.2 in the Environment panel to avoid washed-out shadows.",
    },
    {
      title: "Match HDRI mood to gameplay",
      detail:
        "Sunset/night HDRIs feel atmospheric but kill visibility. Use noon / overcast for combat zones, dusk for hub areas.",
    },
  ],
  "project-asset": [
    {
      title: "Delete unused assets before publishing",
      detail:
        "Project assets are bundled into the published build. Remove unused .glb / textures to keep download size small.",
    },
    {
      title: "Re-host glTFs from your own URL for reliability",
      detail:
        "Third-party CDNs go down. Upload critical models via the Upload File button so your published game doesn't break if a CDN moves.",
    },
  ],
};

export function getBestPractices(ctx: BestPracticeContext): BestPractice[] {
  return BEST_PRACTICES[ctx] ?? [];
}
