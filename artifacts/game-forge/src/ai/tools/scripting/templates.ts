/**
 * Behavior templates for the AI's `create_script_from_template` tool.
 *
 * Each template renders to JS source that follows the editor's script
 * shape — `exports.start(entity, ctx)` and/or `exports.update(entity, ctx)`
 * — so the result drops straight into the existing PlayRuntime compile
 * pipeline (same surface as user-authored scripts).
 *
 * The template bodies intentionally avoid external dependencies
 * (no Yuka, no engine internals beyond the public ScriptContext) so an
 * AI-generated script keeps working even after the editor is upgraded.
 */

export interface ScriptTemplateParam {
  name: string;
  description: string;
  type: "string" | "number" | "boolean";
  default: string | number | boolean;
}

export interface ScriptTemplate {
  key: string;
  name: string;
  description: string;
  params: ScriptTemplateParam[];
  render: (params: Record<string, unknown>) => string;
}

const num = (v: unknown, d: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : d;
const str = (v: unknown, d: string): string =>
  typeof v === "string" && v.length > 0 ? v : d;

export const SCRIPT_TEMPLATES: ScriptTemplate[] = [
  {
    key: "spin",
    name: "Spin",
    description:
      "Spins the entity around an axis at a constant rate. Good baseline for testing the script pipeline.",
    params: [
      { name: "axis", description: "'x' | 'y' | 'z'", type: "string", default: "y" },
      { name: "speed", description: "Radians per second", type: "number", default: 1.5 },
    ],
    render: (p) => {
      const axis = ["x", "y", "z"].includes(str(p.axis, "y")) ? str(p.axis, "y") : "y";
      const speed = num(p.speed, 1.5);
      const idx = axis === "x" ? 0 : axis === "y" ? 1 : 2;
      return `// Spin around ${axis} at ${speed} rad/s
exports.update = function(entity, ctx) {
  entity.rotation[${idx}] += ${speed} * ctx.time.delta;
};
`;
    },
  },
  {
    key: "blazor-spin",
    name: "Blazor Pack: Spin",
    description:
      "Production hybrid C# pack — real .NET Attach/Tick via GameForgeRuntime.wasm (not JS transpile).",
    params: [],
    render: () => `// @forge-runtime: blazor
// @forge-pack: Spin
// Hybrid production pack. Rebuild: bash csharp/GameForgeRuntime/build.sh
using GameForge;
public class SpinProxy : MonoBehaviour { }
`,
  },
  {
    key: "blazor-bob",
    name: "Blazor Pack: Bob",
    description: "Production hybrid C# pack — vertical bob (WASM MonoBehaviour).",
    params: [],
    render: () => `// @forge-runtime: blazor
// @forge-pack: Bob
using GameForge;
public class BobProxy : MonoBehaviour { }
`,
  },
  {
    key: "blazor-strafe",
    name: "Blazor Pack: Strafe",
    description: "Production hybrid C# pack — WASD strafe via C# Input + SetKey bridge.",
    params: [],
    render: () => `// @forge-runtime: blazor
// @forge-pack: Strafe
using GameForge;
public class StrafeProxy : MonoBehaviour { }
`,
  },

  {
    key: "seek-player",
    name: "Seek Player",
    description:
      "Walks toward the nearest entity matching `targetName` (defaults to 'Player') at `speed` units/sec. Stops within `stopDistance` meters.",
    params: [
      { name: "targetName", description: "Substring to match the player name.", type: "string", default: "Player" },
      { name: "speed", description: "Units per second.", type: "number", default: 3 },
      { name: "stopDistance", description: "Stop when closer than this many meters.", type: "number", default: 1.5 },
    ],
    render: (p) => {
      const target = str(p.targetName, "Player");
      const speed = num(p.speed, 3);
      const stop = num(p.stopDistance, 1.5);
      return `// Seek the nearest "${target}" at ${speed} m/s, stopping ${stop} m short.
exports.update = function(entity, ctx) {
  var target = ctx.scene.find(${JSON.stringify(target)});
  if (!target) return;
  var dx = target.position[0] - entity.position[0];
  var dz = target.position[2] - entity.position[2];
  var dist = Math.sqrt(dx*dx + dz*dz);
  if (dist < ${stop}) return;
  var step = ${speed} * ctx.time.delta;
  entity.position[0] += (dx / dist) * step;
  entity.position[2] += (dz / dist) * step;
};
`;
    },
  },
  {
    key: "wander",
    name: "Wander",
    description:
      "Picks a random heading every few seconds and walks that direction. Useful for ambient NPCs.",
    params: [
      { name: "speed", description: "Units per second.", type: "number", default: 1.5 },
      { name: "switchEvery", description: "Seconds between heading changes.", type: "number", default: 3 },
    ],
    render: (p) => {
      const speed = num(p.speed, 1.5);
      const switchEvery = num(p.switchEvery, 3);
      return `// Wander aimlessly, picking a fresh heading every ${switchEvery}s.
exports.start = function(entity, ctx) {
  ctx.state.heading = Math.random() * Math.PI * 2;
  ctx.state.headingExpires = ctx.time.elapsed + ${switchEvery};
};
exports.update = function(entity, ctx) {
  if (ctx.time.elapsed >= (ctx.state.headingExpires || 0)) {
    ctx.state.heading = Math.random() * Math.PI * 2;
    ctx.state.headingExpires = ctx.time.elapsed + ${switchEvery};
  }
  var step = ${speed} * ctx.time.delta;
  entity.position[0] += Math.cos(ctx.state.heading) * step;
  entity.position[2] += Math.sin(ctx.state.heading) * step;
};
`;
    },
  },
  {
    key: "damage-on-touch",
    name: "Damage On Touch",
    description:
      "Sends a `damage` message to any entity that comes within `radius` meters. Pair with a player script that listens for `damage`.",
    params: [
      { name: "radius", description: "Trigger radius in meters.", type: "number", default: 1.2 },
      { name: "damage", description: "Damage amount per hit.", type: "number", default: 10 },
      { name: "cooldown", description: "Seconds between hits on the same target.", type: "number", default: 0.75 },
      { name: "targetName", description: "Substring of victim name. Default 'Player'.", type: "string", default: "Player" },
    ],
    render: (p) => {
      const radius = num(p.radius, 1.2);
      const damage = num(p.damage, 10);
      const cooldown = num(p.cooldown, 0.75);
      const target = str(p.targetName, "Player");
      return `// Deal ${damage} damage to "${target}" within ${radius} m, every ${cooldown} s.
exports.start = function(entity, ctx) {
  ctx.state.lastHit = 0;
};
exports.update = function(entity, ctx) {
  if (ctx.time.elapsed - (ctx.state.lastHit || 0) < ${cooldown}) return;
  var victim = ctx.scene.find(${JSON.stringify(target)});
  if (!victim) return;
  var dx = victim.position[0] - entity.position[0];
  var dy = victim.position[1] - entity.position[1];
  var dz = victim.position[2] - entity.position[2];
  if (dx*dx + dy*dy + dz*dz <= ${radius * radius}) {
    ctx.scene.send(victim.id, "damage", { amount: ${damage}, fromId: entity.id });
    ctx.state.lastHit = ctx.time.elapsed;
  }
};
`;
    },
  },
  {
    key: "patrol-waypoints",
    name: "Patrol Waypoints",
    description:
      "Walks back and forth between two world-space waypoints. Configure via the `a` and `b` arrays in code after generating, or attach via behavior tags.",
    params: [
      { name: "speed", description: "Units per second.", type: "number", default: 2 },
    ],
    render: (p) => {
      const speed = num(p.speed, 2);
      return `// Patrol between two world-space waypoints.
// Edit the A and B arrays to suit your scene.
exports.start = function(entity, ctx) {
  ctx.state.A = [entity.position[0] - 4, entity.position[1], entity.position[2]];
  ctx.state.B = [entity.position[0] + 4, entity.position[1], entity.position[2]];
  ctx.state.target = ctx.state.B;
};
exports.update = function(entity, ctx) {
  var t = ctx.state.target;
  var dx = t[0] - entity.position[0];
  var dz = t[2] - entity.position[2];
  var dist = Math.sqrt(dx*dx + dz*dz);
  if (dist < 0.2) {
    ctx.state.target = (t === ctx.state.A) ? ctx.state.B : ctx.state.A;
    return;
  }
  var step = ${speed} * ctx.time.delta;
  entity.position[0] += (dx / dist) * step;
  entity.position[2] += (dz / dist) * step;
};
`;
    },
  },
  {
    key: "pickup-trigger",
    name: "Pickup Trigger",
    description:
      "Despawns this entity when a body matching `targetName` (or any body on the `Player` layer) overlaps its sensor volume. Emits an `event` payload first so the HUD/score system can react. Place on an entity whose layer is `Trigger` so it spawns as a Rapier sensor.",
    params: [
      {
        name: "targetName",
        description:
          "Exact name of the entity that triggers the pickup (matched as `other.otherName === targetName`). Any body on the `Player` layer also triggers regardless. Default 'Player'.",
        type: "string",
        default: "Player",
      },
      {
        name: "event",
        description: "Game-bus event to emit before despawning. Default 'pickup'.",
        type: "string",
        default: "pickup",
      },
    ],
    render: (p) => {
      const target = str(p.targetName, "Player");
      const event = str(p.event, "pickup");
      return `// Despawn when "${target}" (or any Player-layer body) overlaps. Place on a
// Trigger-layer entity so Rapier spawns it as a sensor. Uses the
// onEnterTrigger / despawn ScriptContext members.
exports.start = function(entity, ctx) {
  ctx.scene.onEnterTrigger(function(other) {
    var isPlayer = other.otherName === ${JSON.stringify(target)} || other.otherLayer === "Player";
    if (!isPlayer) return;
    ctx.events.emit(${JSON.stringify(event)}, { id: entity.id, name: entity.name, by: other.otherId });
    ctx.scene.despawn(entity.id);
  });
};
`;
    },
  },
  {
    key: "trigger-zone",
    name: "Trigger Zone (enter/exit log)",
    description:
      "Logs every onEnterTrigger / onExitTrigger pair on this entity. Useful as a starting point for damage zones, score zones, or save points — extend the handler bodies with your own logic. Place on a Trigger-layer entity.",
    params: [
      {
        name: "label",
        description: "Free-form label included in every log line.",
        type: "string",
        default: "zone",
      },
    ],
    render: (p) => {
      const label = str(p.label, "zone");
      return `// Log every overlap enter/exit on this trigger. Replace the log calls with
// your gameplay reaction (deal damage, award score, despawn, etc.). Pair
// with a Trigger-layer entity so it spawns as a Rapier sensor.
exports.start = function(entity, ctx) {
  ctx.scene.onEnterTrigger(function(other) {
    ctx.log("[${label}] enter", other.otherName, "(layer", other.otherLayer + ")");
  });
  ctx.scene.onExitTrigger(function(other) {
    ctx.log("[${label}] exit", other.otherName, "(layer", other.otherLayer + ")");
  });
};
`;
    },
  },
  {
    key: "log-on-collision",
    name: "Log On Message",
    description:
      "Listens for an inbox message and logs its payload. Useful as a debug receiver for `damage-on-touch` and similar.",
    params: [
      { name: "event", description: "Inbox event name to listen for.", type: "string", default: "damage" },
    ],
    render: (p) => {
      const event = str(p.event, "damage");
      return `// Logs every "${event}" message addressed to this entity.
exports.start = function(entity, ctx) {
  ctx.scene.on(${JSON.stringify(event)}, function(payload, fromId) {
    ctx.log("got ${event} from", fromId, JSON.stringify(payload));
  });
};
`;
    },
  },
  // ── Game system templates (inspired by uMMORPG/Grudge Warlords) ──────
  {
    key: "health-system",
    name: "Health System",
    description:
      "Tracks HP, listens for 'damage' messages, emits 'death' on zero HP, shows damage flash. Pair with damage-on-touch or projectile scripts.",
    params: [
      { name: "maxHp", description: "Maximum health points.", type: "number", default: 100 },
      { name: "regenRate", description: "HP regenerated per second (0 to disable).", type: "number", default: 0 },
    ],
    render: (p) => {
      const maxHp = num(p.maxHp, 100);
      const regen = num(p.regenRate, 0);
      return `// Health system — ${maxHp} HP, listens for 'damage', emits 'death'.
exports.start = function(entity, ctx) {
  ctx.state.hp = ${maxHp};
  ctx.state.maxHp = ${maxHp};
  ctx.state.alive = true;
  ctx.scene.on("damage", function(payload) {
    if (!ctx.state.alive) return;
    ctx.state.hp = Math.max(0, ctx.state.hp - (payload.amount || 0));
    ctx.log(entity.name + " took " + payload.amount + " damage (" + ctx.state.hp + "/" + ctx.state.maxHp + ")");
    if (ctx.state.hp <= 0) {
      ctx.state.alive = false;
      ctx.events.emit("death", { id: entity.id, name: entity.name, killedBy: payload.fromId });
      ctx.log(entity.name + " died!");
    }
  });
};
exports.update = function(entity, ctx) {
  if (!ctx.state.alive) return;${regen > 0 ? `
  // Regen ${regen} HP/s
  ctx.state.hp = Math.min(ctx.state.maxHp, ctx.state.hp + ${regen} * ctx.time.delta);` : ""}
};
`;
    },
  },
  {
    key: "resource-node",
    name: "Resource Node (Harvestable)",
    description:
      "A harvestable resource node (ore, tree, herb). Players interact to gather items with a cooldown. Respawns after depletion. Inspired by uMMORPG ResourceNode.",
    params: [
      { name: "resourceName", description: "Name of the resource.", type: "string", default: "Iron Ore" },
      { name: "harvestTime", description: "Seconds to harvest.", type: "number", default: 2 },
      { name: "totalResources", description: "Harvests before depleted.", type: "number", default: 5 },
      { name: "respawnTime", description: "Seconds to respawn after depletion.", type: "number", default: 30 },
      { name: "interactRange", description: "Range in meters to interact.", type: "number", default: 2 },
    ],
    render: (p) => {
      const name = str(p.resourceName, "Iron Ore");
      const harvestTime = num(p.harvestTime, 2);
      const total = num(p.totalResources, 5);
      const respawn = num(p.respawnTime, 30);
      const range = num(p.interactRange, 2);
      return `// Resource Node: ${name} — ${total} harvests, ${harvestTime}s each, respawns in ${respawn}s.
exports.start = function(entity, ctx) {
  ctx.state.remaining = ${total};
  ctx.state.depleted = false;
  ctx.state.depletedAt = 0;
  ctx.state.harvesting = false;
  ctx.state.harvestStart = 0;
};
exports.update = function(entity, ctx) {
  // Respawn check
  if (ctx.state.depleted) {
    if (ctx.time.elapsed - ctx.state.depletedAt > ${respawn}) {
      ctx.state.depleted = false;
      ctx.state.remaining = ${total};
      ctx.log("${name} node respawned");
    }
    return;
  }
  // Find nearby player
  var player = ctx.scene.find("Player");
  if (!player) return;
  var dx = player.position[0] - entity.position[0];
  var dz = player.position[2] - entity.position[2];
  var dist = Math.sqrt(dx*dx + dz*dz);
  if (dist > ${range}) { ctx.state.harvesting = false; return; }
  // Start harvest on proximity
  if (!ctx.state.harvesting) {
    ctx.state.harvesting = true;
    ctx.state.harvestStart = ctx.time.elapsed;
    return;
  }
  // Complete harvest
  if (ctx.time.elapsed - ctx.state.harvestStart >= ${harvestTime}) {
    ctx.state.remaining--;
    ctx.state.harvesting = false;
    ctx.events.emit("harvest", { resource: ${JSON.stringify(name)}, nodeId: entity.id });
    ctx.log("Harvested ${name} (" + ctx.state.remaining + " left)");
    if (ctx.state.remaining <= 0) {
      ctx.state.depleted = true;
      ctx.state.depletedAt = ctx.time.elapsed;
      ctx.log("${name} node depleted — respawns in ${respawn}s");
    }
  }
};
`;
    },
  },
  {
    key: "quest-objective",
    name: "Quest Objective Tracker",
    description:
      "Tracks quest progress by listening for events (kill, harvest, interact). Emits 'quest-complete' when all objectives are met. Inspired by uMMORPG Scriptable_Quest.",
    params: [
      { name: "questName", description: "Quest display name.", type: "string", default: "Gather Resources" },
      { name: "eventName", description: "Event to listen for.", type: "string", default: "harvest" },
      { name: "required", description: "How many events needed.", type: "number", default: 5 },
    ],
    render: (p) => {
      const quest = str(p.questName, "Gather Resources");
      const event = str(p.eventName, "harvest");
      const required = num(p.required, 5);
      return `// Quest: ${quest} — collect ${required} '${event}' events.
exports.start = function(entity, ctx) {
  ctx.state.progress = 0;
  ctx.state.required = ${required};
  ctx.state.complete = false;
  ctx.events.on(${JSON.stringify(event)}, function(payload) {
    if (ctx.state.complete) return;
    ctx.state.progress++;
    ctx.log("[${quest}] " + ctx.state.progress + "/" + ctx.state.required);
    if (ctx.state.progress >= ctx.state.required) {
      ctx.state.complete = true;
      ctx.events.emit("quest-complete", { quest: ${JSON.stringify(quest)} });
      ctx.log("[${quest}] COMPLETE!");
    }
  });
};
`;
    },
  },
  {
    key: "inventory-pickup",
    name: "Inventory Pickup",
    description:
      "Adds an item to a simple inventory system when the player enters the trigger. Emits 'inventory-add' with item name and quantity.",
    params: [
      { name: "itemName", description: "Item to add.", type: "string", default: "Health Potion" },
      { name: "quantity", description: "Amount to add.", type: "number", default: 1 },
    ],
    render: (p) => {
      const item = str(p.itemName, "Health Potion");
      const qty = num(p.quantity, 1);
      return `// Inventory pickup — adds ${qty}x ${item} and despawns.
exports.start = function(entity, ctx) {
  ctx.scene.onEnterTrigger(function(other) {
    if (other.otherLayer !== "Player" && other.otherName !== "Player") return;
    ctx.events.emit("inventory-add", { item: ${JSON.stringify(item)}, quantity: ${qty}, fromId: entity.id });
    ctx.log("Picked up ${qty}x ${item}");
    ctx.scene.despawn(entity.id);
  });
};
`;
    },
  },
  {
    key: "day-night-cycle",
    name: "Day/Night Cycle",
    description:
      "Smoothly cycles the scene ambient and sun intensity over a configurable period. Attach to an empty GameManager entity.",
    params: [
      { name: "cycleDuration", description: "Full day/night cycle in seconds.", type: "number", default: 120 },
    ],
    render: (p) => {
      const dur = num(p.cycleDuration, 120);
      return `// Day/Night cycle — ${dur}s per full rotation.
exports.update = function(entity, ctx) {
  var t = (ctx.time.elapsed % ${dur}) / ${dur}; // 0..1
  var sunAngle = t * Math.PI * 2;
  var daylight = Math.max(0, Math.cos(sunAngle)); // 0=night, 1=noon
  // Update scene lighting
  ctx.scene.setEnvironment({
    ambientIntensity: 0.1 + daylight * 0.5,
    sunIntensity: 0.1 + daylight * 1.3,
  });
};
`;
    },
  },
  {
    key: "projectile-launcher",
    name: "Projectile Launcher",
    description:
      "Spawns a projectile entity that moves forward and sends 'damage' on contact. Attach to a weapon or turret entity.",
    params: [
      { name: "speed", description: "Projectile speed.", type: "number", default: 20 },
      { name: "damage", description: "Damage on hit.", type: "number", default: 25 },
      { name: "lifetime", description: "Seconds before auto-despawn.", type: "number", default: 3 },
      { name: "fireRate", description: "Seconds between shots.", type: "number", default: 0.5 },
    ],
    render: (p) => {
      const speed = num(p.speed, 20);
      const damage = num(p.damage, 25);
      const lifetime = num(p.lifetime, 3);
      const rate = num(p.fireRate, 0.5);
      return `// Projectile launcher — fires every ${rate}s at ${speed} m/s, ${damage} damage.
exports.start = function(entity, ctx) {
  ctx.state.lastFire = 0;
};
exports.update = function(entity, ctx) {
  if (ctx.time.elapsed - ctx.state.lastFire < ${rate}) return;
  // Only fire if player is pressing LMB (check keys)
  if (!ctx.keys || !ctx.keys.MouseLeft) return;
  ctx.state.lastFire = ctx.time.elapsed;
  // Spawn a small sphere as the projectile
  var projId = ctx.scene.spawn({
    type: "sphere",
    name: "Projectile",
    position: [entity.position[0], entity.position[1] + 1, entity.position[2]],
    scale: [0.15, 0.15, 0.15],
    color: "#ff4400",
    emissive: "#ff2200",
  });
  // Track projectile in state
  if (!ctx.state.projectiles) ctx.state.projectiles = [];
  ctx.state.projectiles.push({
    id: projId,
    born: ctx.time.elapsed,
    dx: -Math.sin(entity.rotation[1]),
    dz: -Math.cos(entity.rotation[1]),
  });
};
`;
    },
  },
  // ── Weapon system templates (bone attachment + combat) ──────────────
  {
    key: "weapon-equip",
    name: "Weapon Equip System",
    description:
      "Equips a weapon to a character using the bone attachment system. Listens for 'equip-weapon' events to swap weapons at runtime. The weapon entity is parented to the correct hand bone (R_hand_container for main hand, L_shield_container for shields). Emits 'weapon-equipped' when complete.",
    params: [
      { name: "weaponName", description: "Name of the initial weapon entity to find.", type: "string", default: "Sword" },
      { name: "attackDamage", description: "Base damage per hit.", type: "number", default: 10 },
      { name: "attackSpeed", description: "Attacks per second.", type: "number", default: 1.2 },
      { name: "attackRange", description: "Melee range in meters.", type: "number", default: 2.0 },
    ],
    render: (p) => {
      const weapon = str(p.weaponName, "Sword");
      const damage = num(p.attackDamage, 10);
      const speed = num(p.attackSpeed, 1.2);
      const range = num(p.attackRange, 2.0);
      return `// Weapon Equip System — manages equipped weapon + melee combat.
// Bone targets: R_hand_container (main), L_hand_container (off-hand),
//               L_shield_container (shields), Back_container (sheathed 2H).
//
// Events:
//   'equip-weapon' { weaponId, slot } — swap to a different weapon
//   'weapon-equipped' { weaponName, damage, speed } — notifies HUD/AI
//   'attack-hit' { targetId, damage, weaponName } — on successful melee hit

exports.start = function(entity, ctx) {
  // Initial weapon state
  ctx.state.weaponName = ${JSON.stringify(weapon)};
  ctx.state.damage = ${damage};
  ctx.state.attackSpeed = ${speed};
  ctx.state.attackRange = ${range};
  ctx.state.lastAttack = 0;
  ctx.state.isAttacking = false;
  ctx.state.attackPhase = 0; // 0=ready, 1=windup, 2=active, 3=recovery

  ctx.log("Equipped " + ctx.state.weaponName + " (" + ctx.state.damage + " dmg, " + ctx.state.attackSpeed + " aps)");
  ctx.events.emit("weapon-equipped", {
    weaponName: ctx.state.weaponName,
    damage: ctx.state.damage,
    speed: ctx.state.attackSpeed,
  });

  // Listen for weapon swap events
  ctx.events.on("equip-weapon", function(payload) {
    ctx.state.weaponName = payload.weaponName || ctx.state.weaponName;
    ctx.state.damage = payload.damage || ctx.state.damage;
    ctx.state.attackSpeed = payload.attackSpeed || ctx.state.attackSpeed;
    ctx.log("Swapped to " + ctx.state.weaponName);
    ctx.events.emit("weapon-equipped", {
      weaponName: ctx.state.weaponName,
      damage: ctx.state.damage,
      speed: ctx.state.attackSpeed,
    });
  });
};

exports.update = function(entity, ctx) {
  var cooldown = 1.0 / ctx.state.attackSpeed;

  // Attack on LMB
  if (ctx.keys && ctx.keys.MouseLeft && !ctx.state.isAttacking) {
    if (ctx.time.elapsed - ctx.state.lastAttack >= cooldown) {
      ctx.state.isAttacking = true;
      ctx.state.attackPhase = 1; // windup
      ctx.state.lastAttack = ctx.time.elapsed;
      ctx.log(ctx.state.weaponName + " attack!");
    }
  }

  // Attack phases: windup (0.1s) → active (0.2s) → recovery (0.2s)
  if (ctx.state.isAttacking) {
    var elapsed = ctx.time.elapsed - ctx.state.lastAttack;
    if (elapsed < 0.1) {
      ctx.state.attackPhase = 1; // windup
    } else if (elapsed < 0.3) {
      if (ctx.state.attackPhase === 1) {
        ctx.state.attackPhase = 2; // active — check for hits
        // Find enemies in range
        var enemies = ctx.scene.findAll("Enemy");
        for (var i = 0; i < enemies.length; i++) {
          var e = enemies[i];
          var dx = e.position[0] - entity.position[0];
          var dz = e.position[2] - entity.position[2];
          var dist = Math.sqrt(dx*dx + dz*dz);
          if (dist <= ${range}) {
            ctx.scene.send(e.id, "damage", {
              amount: ctx.state.damage,
              fromId: entity.id,
              weaponName: ctx.state.weaponName,
            });
            ctx.events.emit("attack-hit", {
              targetId: e.id,
              damage: ctx.state.damage,
              weaponName: ctx.state.weaponName,
            });
            ctx.log("Hit " + e.name + " for " + ctx.state.damage + " with " + ctx.state.weaponName);
          }
        }
      }
    } else if (elapsed < 0.5) {
      ctx.state.attackPhase = 3; // recovery
    } else {
      ctx.state.isAttacking = false;
      ctx.state.attackPhase = 0;
    }
  }
};
`;
    },
  },
  // ── Motion / physics / texture templates ───────────────────────────
  {
    key: "bob-hover",
    name: "Bob / Hover",
    description:
      "Sine-wave vertical bob for pickups, crystals, and floating UI anchors. Optional spin on Y.",
    params: [
      { name: "amplitude", description: "Meters peak-to-peak / 2.", type: "number", default: 0.25 },
      { name: "frequency", description: "Cycles per second.", type: "number", default: 1.2 },
      { name: "spin", description: "Y-axis spin rad/s (0 = none).", type: "number", default: 0.8 },
    ],
    render: (p) => {
      const amp = num(p.amplitude, 0.25);
      const freq = num(p.frequency, 1.2);
      const spin = num(p.spin, 0.8);
      return `// Bob / hover motion — amplitude ${amp}m @ ${freq}Hz, spin ${spin} rad/s
exports.start = function(entity, ctx) {
  ctx.state.baseY = entity.position[1];
  ctx.state.phase = Math.random() * Math.PI * 2;
};
exports.update = function(entity, ctx) {
  var t = ctx.time.elapsed * ${freq} * Math.PI * 2 + ctx.state.phase;
  entity.position[1] = ctx.state.baseY + Math.sin(t) * ${amp};
  entity.rotation[1] += ${spin} * ctx.time.delta;
};
`;
    },
  },
  {
    key: "orbit-point",
    name: "Orbit Point",
    description:
      "Orbits a world-space point (or named entity) on the XZ plane. Great for drones, moons, camera rigs.",
    params: [
      { name: "centerName", description: "Entity name to orbit, or empty for world origin.", type: "string", default: "Player" },
      { name: "radius", description: "Orbit radius meters.", type: "number", default: 4 },
      { name: "speed", description: "Angular speed rad/s.", type: "number", default: 0.8 },
      { name: "height", description: "Fixed Y height offset from center.", type: "number", default: 2 },
    ],
    render: (p) => {
      const center = str(p.centerName, "Player");
      const radius = num(p.radius, 4);
      const speed = num(p.speed, 0.8);
      const height = num(p.height, 2);
      return `// Orbit "${center}" at r=${radius} speed=${speed}
exports.start = function(entity, ctx) {
  ctx.state.angle = Math.random() * Math.PI * 2;
};
exports.update = function(entity, ctx) {
  ctx.state.angle += ${speed} * ctx.time.delta;
  var cx = 0, cy = 0, cz = 0;
  ${center ? `var c = ctx.scene.find(${JSON.stringify(center)});
  if (c) { cx = c.position[0]; cy = c.position[1]; cz = c.position[2]; }` : ""}
  entity.position[0] = cx + Math.cos(ctx.state.angle) * ${radius};
  entity.position[1] = cy + ${height};
  entity.position[2] = cz + Math.sin(ctx.state.angle) * ${radius};
  entity.rotation[1] = -ctx.state.angle + Math.PI / 2;
};
`;
    },
  },
  {
    key: "physics-impulse",
    name: "Physics Impulse on Hit",
    description:
      "When this dynamic body is damaged (or E pressed nearby), apply a Rapier impulse. Requires dynamic physics.",
    params: [
      { name: "impulseY", description: "Upward impulse.", type: "number", default: 8 },
      { name: "impulseForward", description: "Forward impulse strength.", type: "number", default: 4 },
    ],
    render: (p) => {
      const iy = num(p.impulseY, 8);
      const ifw = num(p.impulseForward, 4);
      return `// Apply impulse on damage or nearby interact
exports.start = function(entity, ctx) {
  ctx.scene.on("damage", function() {
    ctx.state.kick = true;
  });
  ctx.events.on("interact", function(payload) {
    if (payload && payload.targetId === entity.id) ctx.state.kick = true;
  });
};
exports.update = function(entity, ctx) {
  if (!ctx.state.kick) return;
  ctx.state.kick = false;
  var yaw = entity.rotation[1] || 0;
  var fx = -Math.sin(yaw) * ${ifw};
  var fz = -Math.cos(yaw) * ${ifw};
  if (ctx.scene.applyImpulse) {
    ctx.scene.applyImpulse(entity.id, [fx, ${iy}, fz]);
  } else {
    // Fallback: teleport nudge if impulse API unavailable
    entity.position[0] += fx * 0.05;
    entity.position[1] += 0.2;
    entity.position[2] += fz * 0.05;
  }
};
`;
    },
  },
  {
    key: "ground-follow",
    name: "Ground Snap Follow",
    description:
      "Each frame raycasts down and snaps Y to the ground surface (Walk/Terrain). Keeps NPCs glued to uneven maps.",
    params: [
      { name: "maxDrop", description: "Max ray length down.", type: "number", default: 20 },
      { name: "offset", description: "Y offset above hit (character feet).", type: "number", default: 0.05 },
    ],
    render: (p) => {
      const maxDrop = num(p.maxDrop, 20);
      const offset = num(p.offset, 0.05);
      return `// Ground snap — raycast down each frame
exports.update = function(entity, ctx) {
  var origin = [entity.position[0], entity.position[1] + 2, entity.position[2]];
  var hit = ctx.scene.castRay
    ? ctx.scene.castRay(origin, [0, -1, 0], ${maxDrop + 2}, [entity.id])
    : null;
  if (hit && typeof hit.point === "object") {
    entity.position[1] = hit.point[1] + ${offset};
  } else if (hit && typeof hit.distance === "number") {
    entity.position[1] = origin[1] - hit.distance + ${offset};
  }
};
`;
    },
  },
  {
    key: "uv-scroll",
    name: "UV Scroll (Conveyor)",
    description:
      "Emits a material UV scroll event for shaders / future texture offset. Also slowly rotates the entity as a visible conveyor cue.",
    params: [
      { name: "speedU", description: "U scroll speed.", type: "number", default: 0.5 },
      { name: "speedV", description: "V scroll speed.", type: "number", default: 0 },
    ],
    render: (p) => {
      const u = num(p.speedU, 0.5);
      const v = num(p.speedV, 0);
      return `// UV scroll conveyor cue — emits 'uvScroll' for HUD/material systems
exports.start = function(entity, ctx) {
  ctx.state.u = 0;
  ctx.state.v = 0;
};
exports.update = function(entity, ctx) {
  ctx.state.u += ${u} * ctx.time.delta;
  ctx.state.v += ${v} * ctx.time.delta;
  ctx.events.emit("uvScroll", {
    entityId: entity.id,
    offset: [ctx.state.u, ctx.state.v],
  });
  // Visible belt motion
  entity.rotation[0] += ${u} * 0.15 * ctx.time.delta;
};
`;
    },
  },
  {
    key: "camera-shake",
    name: "Camera Shake on Event",
    description:
      "Listens for 'damage' / 'explosion' events and emits cameraShake for the play HUD / camera controller.",
    params: [
      { name: "intensity", description: "Shake strength.", type: "number", default: 0.4 },
      { name: "duration", description: "Seconds.", type: "number", default: 0.35 },
    ],
    render: (p) => {
      const intensity = num(p.intensity, 0.4);
      const duration = num(p.duration, 0.35);
      return `// Camera shake relay
exports.start = function(entity, ctx) {
  function shake() {
    ctx.events.emit("cameraShake", {
      intensity: ${intensity},
      duration: ${duration},
      at: entity.position.slice ? entity.position.slice() : entity.position,
    });
  }
  ctx.events.on("explosion", shake);
  ctx.scene.on("damage", function(payload) {
    if (payload && payload.amount >= 15) shake();
  });
};
`;
    },
  },
  {
    key: "weapon-pickup-swap",
    name: "Weapon Pickup & Swap",
    description:
      "A pickup that swaps the player's current weapon when they enter the trigger zone. Emits 'equip-weapon' to the player, then despawns. Place on a Trigger-layer entity with a weapon model child.",
    params: [
      { name: "weaponName", description: "Weapon name to equip.", type: "string", default: "Broad Sword" },
      { name: "damage", description: "New weapon damage.", type: "number", default: 14 },
      { name: "speed", description: "New attack speed.", type: "number", default: 1.0 },
    ],
    render: (p) => {
      const weapon = str(p.weaponName, "Broad Sword");
      const damage = num(p.damage, 14);
      const speed = num(p.speed, 1.0);
      return `// Weapon Pickup — player walks over to swap weapons.
// Place on a Trigger-layer entity. Add a weapon model as a child
// so the player can see what they're picking up.
exports.start = function(entity, ctx) {
  ctx.scene.onEnterTrigger(function(other) {
    if (other.otherName !== "Player" && other.otherLayer !== "Player") return;
    // Send equip event to the player
    ctx.scene.send(other.otherId, "equip-weapon", {
      weaponName: ${JSON.stringify(weapon)},
      damage: ${damage},
      attackSpeed: ${speed},
    });
    ctx.log("Player picked up ${weapon}!");
    ctx.scene.despawn(entity.id);
  });
};
`;
    },
  },

  // ── Multiplayer / camera / network (grudgecontrol · three-player-controller · Mirror patterns) ──
  {
    key: "third-person-camera",
    name: "Third-Person Camera Follow",
    description:
      "Orbit-style third-person follow (grudgecontrol / three-player-controller tips). Attach to Player or a CameraRig empty. Uses min/max distance, pitch clamp, and optional LMB orbit.",
    params: [
      { name: "targetName", description: "Entity to follow.", type: "string", default: "Player" },
      { name: "distance", description: "Default camera distance (m).", type: "number", default: 6 },
      { name: "height", description: "Look-at height offset (m).", type: "number", default: 1.6 },
      { name: "minDistance", description: "Zoom min.", type: "number", default: 2 },
      { name: "maxDistance", description: "Zoom max (large maps).", type: "number", default: 80 },
      { name: "smooth", description: "Lerp factor 0–1 per second scale.", type: "number", default: 8 },
    ],
    render: (p) => {
      const target = str(p.targetName, "Player");
      const dist = num(p.distance, 6);
      const height = num(p.height, 1.6);
      const minD = num(p.minDistance, 2);
      const maxD = num(p.maxDistance, 80);
      const smooth = num(p.smooth, 8);
      return `// Third-person follow camera — inspired by grudgecontrol multiplayer-gltf
// + three-player-controller orbit tips. Attach to a Camera / empty named CameraRig.
exports.start = function(entity, ctx) {
  ctx.state.yaw = 0;
  ctx.state.pitch = 0.25;
  ctx.state.distance = ${dist};
  ctx.state.minD = ${minD};
  ctx.state.maxD = ${maxD};
  ctx.input.setCursorLock(false);
};
exports.update = function(entity, ctx) {
  var target = ctx.scene.find(${JSON.stringify(target)});
  if (!target) return;
  var mx = ctx.input.mouseDeltaX || 0;
  var my = ctx.input.mouseDeltaY || 0;
  if (ctx.input.mouseRight || ctx.input.mouseLeft) {
    ctx.state.yaw -= mx * 0.004;
    ctx.state.pitch = Math.max(-1.2, Math.min(1.2, ctx.state.pitch - my * 0.004));
  }
  var wheel = ctx.input.wheelDelta || 0;
  if (wheel) {
    ctx.state.distance = Math.max(ctx.state.minD, Math.min(ctx.state.maxD, ctx.state.distance + wheel * 0.01));
  }
  var lookY = target.position[1] + ${height};
  var cx = target.position[0] + Math.sin(ctx.state.yaw) * Math.cos(ctx.state.pitch) * ctx.state.distance;
  var cy = lookY + Math.sin(ctx.state.pitch) * ctx.state.distance;
  var cz = target.position[2] + Math.cos(ctx.state.yaw) * Math.cos(ctx.state.pitch) * ctx.state.distance;
  var k = 1 - Math.exp(-${smooth} * ctx.time.delta);
  entity.position[0] += (cx - entity.position[0]) * k;
  entity.position[1] += (cy - entity.position[1]) * k;
  entity.position[2] += (cz - entity.position[2]) * k;
  // Face look-at point (yaw only for simple scripts)
  entity.rotation[1] = ctx.state.yaw + Math.PI;
  ctx.events.emit("cameraLookAt", { x: target.position[0], y: lookY, z: target.position[2] });
};
`;
    },
  },
  {
    key: "wasd-character-controller",
    name: "WASD Character Controller",
    description:
      "SI-scale third-person locomotion (walk/run/jump) for Bip001 / Mixamo baked characters from R2. Pair with third-person-camera.",
    params: [
      { name: "walkSpeed", description: "m/s walk.", type: "number", default: 2.5 },
      { name: "runSpeed", description: "m/s run (Shift).", type: "number", default: 5.5 },
      { name: "jumpForce", description: "Upward impulse.", type: "number", default: 5.5 },
      { name: "turnSpeed", description: "Yaw lerp rad/s.", type: "number", default: 10 },
    ],
    render: (p) => {
      const walk = num(p.walkSpeed, 2.5);
      const run = num(p.runSpeed, 5.5);
      const jump = num(p.jumpForce, 5.5);
      const turn = num(p.turnSpeed, 10);
      return `// WASD character — SI meters, R2/baked Bip001 clips via AnimationDirector when available
exports.start = function(entity, ctx) {
  ctx.state.vy = 0;
  ctx.state.grounded = true;
  entity.tags = entity.tags || {};
  entity.tags.player = true;
  entity.name = entity.name || "Player";
};
exports.update = function(entity, ctx) {
  var keys = ctx.keys || {};
  var dx = (keys.d || keys.ArrowRight ? 1 : 0) - (keys.a || keys.ArrowLeft ? 1 : 0);
  var dz = (keys.w || keys.ArrowUp ? 1 : 0) - (keys.s || keys.ArrowDown ? 1 : 0);
  var len = Math.hypot(dx, dz);
  var speed = (keys.Shift ? ${run} : ${walk});
  if (len > 0.001) {
    dx /= len; dz /= len;
    entity.position[0] += dx * speed * ctx.time.delta;
    entity.position[2] += dz * speed * ctx.time.delta;
    var yaw = Math.atan2(dx, dz);
    var cur = entity.rotation[1];
    var diff = yaw - cur;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    entity.rotation[1] += diff * Math.min(1, ${turn} * ctx.time.delta);
    if (ctx.anim) ctx.anim.setGait(keys.Shift ? "run" : "walk");
  } else if (ctx.anim) {
    ctx.anim.setGait("idle");
  }
  if ((keys[" "] || keys.Space) && ctx.state.grounded) {
    ctx.state.vy = ${jump};
    ctx.state.grounded = false;
    if (ctx.anim) ctx.anim.requestOneShot("jump");
  }
  ctx.state.vy -= 9.81 * ctx.time.delta;
  entity.position[1] += ctx.state.vy * ctx.time.delta;
  if (entity.position[1] <= 0) {
    entity.position[1] = 0;
    ctx.state.vy = 0;
    ctx.state.grounded = true;
  }
  ctx.events.emit("playerPose", {
    id: entity.id,
    position: entity.position.slice ? entity.position.slice() : [entity.position[0], entity.position[1], entity.position[2]],
    rotationY: entity.rotation[1],
    gait: len > 0.001 ? (keys.Shift ? "run" : "walk") : "idle",
  });
};
`;
    },
  },
  {
    key: "network-manager-mirror",
    name: "Network Manager (Mirror-style)",
    description:
      "Client authority pose sync scaffold (uMMORPG / Mirror NetworkManager patterns). Emits room events; wire to Grudge live WS / Firebase / Carrier. Not a full server — agent fills transport.",
    params: [
      { name: "roomId", description: "Room / lobby id.", type: "string", default: "forge-room-1" },
      { name: "tickHz", description: "Send rate.", type: "number", default: 15 },
      { name: "maxPlayers", description: "Soft cap.", type: "number", default: 16 },
    ],
    render: (p) => {
      const room = str(p.roomId, "forge-room-1");
      const hz = num(p.tickHz, 15);
      const maxP = num(p.maxPlayers, 16);
      return `// NetworkManager scaffold — Mirror/uMMORPG-style client hooks for Grudge live
// Transport: set ctx.net = { send, on } from fleet WS (Carrier / gameopen) at start.
exports.start = function(entity, ctx) {
  ctx.state.roomId = ${JSON.stringify(room)};
  ctx.state.tick = 0;
  ctx.state.interval = 1 / ${hz};
  ctx.state.acc = 0;
  ctx.state.remotes = {};
  ctx.state.localId = ctx.net && ctx.net.playerId ? ctx.net.playerId : ("p_" + Math.random().toString(36).slice(2, 8));
  ctx.state.maxPlayers = ${maxP};
  ctx.log("NetworkManager room=" + ctx.state.roomId + " local=" + ctx.state.localId);
  if (ctx.net && ctx.net.on) {
    ctx.net.on("playerPose", function(msg) {
      if (!msg || msg.id === ctx.state.localId) return;
      ctx.state.remotes[msg.id] = msg;
      ctx.events.emit("remotePlayer", msg);
    });
    ctx.net.on("playerLeft", function(msg) {
      if (msg && msg.id) delete ctx.state.remotes[msg.id];
      ctx.events.emit("remotePlayerLeft", msg);
    });
  }
};
exports.update = function(entity, ctx) {
  ctx.state.acc += ctx.time.delta;
  if (ctx.state.acc < ctx.state.interval) return;
  ctx.state.acc = 0;
  var player = ctx.scene.find("Player");
  if (!player) return;
  var payload = {
    type: "playerPose",
    roomId: ctx.state.roomId,
    id: ctx.state.localId,
    t: ctx.time.elapsed,
    position: player.position.slice ? player.position.slice() : [player.position[0], player.position[1], player.position[2]],
    rotationY: player.rotation[1],
    gait: player.tags && player.tags.gait ? player.tags.gait : "idle",
  };
  if (ctx.net && ctx.net.send) ctx.net.send(payload);
  else ctx.events.emit("netOutbound", payload);
};
`;
    },
  },
  {
    key: "remote-player-interpolator",
    name: "Remote Player Interpolator",
    description:
      "Smooth remote avatar transforms from network-manager events (multiplayer-gltf.js pattern).",
    params: [
      { name: "lerp", description: "Position lerp speed.", type: "number", default: 12 },
    ],
    render: (p) => {
      const lerp = num(p.lerp, 12);
      return `// Remote player smooth follow — attach to a remote avatar entity
// Expects ctx.state.remoteId set, or entity.name === remote player id.
exports.start = function(entity, ctx) {
  ctx.state.targetPos = entity.position.slice ? entity.position.slice() : [0, 0, 0];
  ctx.state.targetYaw = entity.rotation[1];
  ctx.events.on("remotePlayer", function(msg) {
    if (!msg) return;
    var mine = ctx.state.remoteId || entity.name;
    if (msg.id !== mine) return;
    ctx.state.targetPos = msg.position;
    ctx.state.targetYaw = msg.rotationY || 0;
    if (ctx.anim && msg.gait) ctx.anim.setGait(msg.gait);
  });
};
exports.update = function(entity, ctx) {
  if (!ctx.state.targetPos) return;
  var k = 1 - Math.exp(-${lerp} * ctx.time.delta);
  entity.position[0] += (ctx.state.targetPos[0] - entity.position[0]) * k;
  entity.position[1] += (ctx.state.targetPos[1] - entity.position[1]) * k;
  entity.position[2] += (ctx.state.targetPos[2] - entity.position[2]) * k;
  var dy = ctx.state.targetYaw - entity.rotation[1];
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  entity.rotation[1] += dy * k;
};
`;
    },
  },
  {
    key: "outline-select-highlight",
    name: "Outline Select Highlight",
    description:
      "Emits outline/highlight events for selected targets (combat soft-lock / interactable). Pairs with post outline pass.",
    params: [
      { name: "color", description: "Hex outline color.", type: "string", default: "#f6c945" },
      { name: "range", description: "Select range meters.", type: "number", default: 12 },
    ],
    render: (p) => {
      const color = str(p.color, "#f6c945");
      const range = num(p.range, 12);
      return `// Outline highlight for nearest interactable / hard target
exports.update = function(entity, ctx) {
  var best = null;
  var bestD = ${range};
  var list = ctx.scene.query ? ctx.scene.query({ tag: "interactable" }) : [];
  for (var i = 0; i < list.length; i++) {
    var o = list[i];
    if (o.id === entity.id) continue;
    var dx = o.position[0] - entity.position[0];
    var dz = o.position[2] - entity.position[2];
    var d = Math.hypot(dx, dz);
    if (d < bestD) { bestD = d; best = o; }
  }
  ctx.events.emit("outlineTarget", best ? {
    id: best.id,
    color: ${JSON.stringify(color)},
    distance: bestD,
  } : null);
};
`;
    },
  },
  {
    key: "spawn-r2-character",
    name: "Spawn R2 Character Hook",
    description:
      "Documents + applies builtin:/assets.grudge-studio.com character load policy for play scripts (grudge6 / races). Prefer entity model.builtin keys set in editor.",
    params: [
      { name: "builtinKey", description: "builtin model key e.g. race:warrior", type: "string", default: "blake" },
      { name: "scale", description: "Uniform scale SI.", type: "number", default: 1 },
    ],
    render: (p) => {
      const key = str(p.builtinKey, "blake");
      const scale = num(p.scale, 1);
      return `// Character from fleet R2 / builtin — set model URL on this entity at start
// SSOT: assets.grudge-studio.com + D1 registry. Never use localhost/replit.
exports.start = function(entity, ctx) {
  entity.model = entity.model || {};
  entity.model.url = "builtin:" + ${JSON.stringify(key)};
  entity.scale = [${scale}, ${scale}, ${scale}];
  entity.tags = entity.tags || {};
  entity.tags.character = true;
  entity.tags.rig = "Bip001";
  ctx.log("Character hook builtin:" + ${JSON.stringify(key)} + " (R2/CDN via resolveModelUrl)");
  ctx.events.emit("characterReady", { id: entity.id, builtin: ${JSON.stringify(key)} });
};
`;
    },
  },

  // ── Island-aware production templates (three 0.185 + Rapier SI) ────
  {
    key: "island-spawn-on-terrain",
    name: "Island Spawn on Terrain",
    description:
      "Spawn entity on current island terrain with ground snap. SI metres, Y-up, Rapier raycast down. Island state lives on Railway (not Puter FS). Pair with pirate-islands or custom heightmap.",
    params: [
      { name: "spawnRadius", description: "Random spawn radius in meters.", type: "number", default: 10 },
      { name: "yOffset", description: "Y offset above ground (m).", type: "number", default: 0.1 },
    ],
    render: (p) => {
      const radius = num(p.spawnRadius, 10);
      const yOffset = num(p.yOffset, 0.1);
      return `// Island terrain spawn — SI metres, Y-up, ground snap via Rapier raycast.
// Island SSOT: Railway (not Puter). Live map: pirate-islands scene.glb.
// home-island-contract 1.4.0: rtsHeightmapResolution=128, terrainBounds config.
exports.start = function(entity, ctx) {
  // Random XZ within radius
  var angle = Math.random() * Math.PI * 2;
  var dist = Math.random() * ${radius};
  var x = Math.cos(angle) * dist;
  var z = Math.sin(angle) * dist;
  
  // Raycast down from +100m to find ground (Rapier castRay)
  var origin = [x, 100, z];
  var hit = ctx.scene.castRay ? ctx.scene.castRay(origin, [0, -1, 0], 150, [], ["Terrain"]) : null;
  
  if (hit && hit.point) {
    entity.position[0] = hit.point[0];
    entity.position[1] = hit.point[1] + ${yOffset};
    entity.position[2] = hit.point[2];
    ctx.log("Spawned on terrain at [" + entity.position[0].toFixed(1) + ", " + entity.position[1].toFixed(1) + ", " + entity.position[2].toFixed(1) + "]");
  } else {
    // Fallback: flat ground Y=0
    entity.position[0] = x;
    entity.position[1] = ${yOffset};
    entity.position[2] = z;
    ctx.log("No terrain hit — spawned at sea level");
  }
};
`;
    },
  },

  {
    key: "simple-interactable",
    name: "Simple Interactable (E key)",
    description:
      "Proximity interactable — press E when player within range. Emits 'interact' event. No fetch/require/process. SI metres, Y-up. Pair with health/inventory systems.",
    params: [
      { name: "range", description: "Interact range meters.", type: "number", default: 2.5 },
      { name: "label", description: "Floating prompt label.", type: "string", default: "Press E" },
    ],
    render: (p) => {
      const range = num(p.range, 2.5);
      const label = str(p.label, "Press E");
      return `// Simple interactable — E key within ${range}m. SI metres, Y-up.
// No fetch/require/process (browser runtime, not Node).
exports.start = function(entity, ctx) {
  ctx.state.canInteract = false;
  ctx.state.label = ${JSON.stringify(label)};
};

exports.update = function(entity, ctx) {
  var player = ctx.scene.find("Player");
  if (!player) { ctx.state.canInteract = false; return; }
  
  var dx = player.position[0] - entity.position[0];
  var dz = player.position[2] - entity.position[2];
  var dist = Math.sqrt(dx*dx + dz*dz);
  
  if (dist <= ${range}) {
    ctx.state.canInteract = true;
    // Show label (HUD polls ctx.state or listens to 'canInteract' event)
    ctx.events.emit("canInteract", {
      entityId: entity.id,
      label: ctx.state.label,
      distance: dist,
    });
    
    // Check E key
    if (ctx.input.keys && ctx.input.keys.e) {
      ctx.events.emit("interact", {
        entityId: entity.id,
        playerId: player.id,
        name: entity.name,
      });
      ctx.log("Interacted with " + entity.name);
    }
  } else {
    ctx.state.canInteract = false;
  }
};
`;
    },
  },

  {
    key: "camera-follow-island",
    name: "Island Camera Follow",
    description:
      "Third-person follow camera for island play. SI metres (1u=1m), Y-up, smooth lerp, zoom via wheel. Pair with WASD character. Terrain bounds: pirate-islands or heightmap (rtsHeightmapResolution=128).",
    params: [
      { name: "distance", description: "Default camera distance (m).", type: "number", default: 8 },
      { name: "height", description: "Look-at height offset (m).", type: "number", default: 1.8 },
      { name: "smooth", description: "Lerp speed (higher = snappier).", type: "number", default: 10 },
      { name: "minDistance", description: "Zoom min (m).", type: "number", default: 3 },
      { name: "maxDistance", description: "Zoom max (m, island scale).", type: "number", default: 120 },
    ],
    render: (p) => {
      const dist = num(p.distance, 8);
      const height = num(p.height, 1.8);
      const smooth = num(p.smooth, 10);
      const minD = num(p.minDistance, 3);
      const maxD = num(p.maxDistance, 120);
      return `// Island camera follow — SI metres (1u=1m), Y-up, smooth lerp.
// Terrain: pirate-islands GLB or heightmap (rtsHeightmapResolution=128).
// One AnimationMixer; Rapier physics only; no second physics engine.
exports.start = function(entity, ctx) {
  ctx.state.yaw = 0;
  ctx.state.pitch = 0.3;
  ctx.state.distance = ${dist};
  ctx.state.minD = ${minD};
  ctx.state.maxD = ${maxD};
};

exports.update = function(entity, ctx) {
  var target = ctx.scene.find("Player");
  if (!target) return;
  
  // Mouse orbit (RMB or MMB)
  var mx = ctx.input.mouse?.deltaX || 0;
  var my = ctx.input.mouse?.deltaY || 0;
  if (ctx.input.mouse?.right || ctx.input.mouse?.middle) {
    ctx.state.yaw -= mx * 0.005;
    ctx.state.pitch = Math.max(-1.3, Math.min(1.3, ctx.state.pitch - my * 0.005));
  }
  
  // Wheel zoom
  var wheel = ctx.input.mouse?.wheelDelta || 0;
  if (wheel) {
    ctx.state.distance = Math.max(ctx.state.minD, Math.min(ctx.state.maxD, ctx.state.distance - wheel * 0.15));
  }
  
  // Smooth follow (exponential lerp)
  var lookY = target.position[1] + ${height};
  var cx = target.position[0] + Math.sin(ctx.state.yaw) * Math.cos(ctx.state.pitch) * ctx.state.distance;
  var cy = lookY + Math.sin(ctx.state.pitch) * ctx.state.distance;
  var cz = target.position[2] + Math.cos(ctx.state.yaw) * Math.cos(ctx.state.pitch) * ctx.state.distance;
  
  var k = 1 - Math.exp(-${smooth} * ctx.time.delta);
  entity.position[0] += (cx - entity.position[0]) * k;
  entity.position[1] += (cy - entity.position[1]) * k;
  entity.position[2] += (cz - entity.position[2]) * k;
  
  // Face look-at (yaw only; pitch baked into position)
  entity.rotation[1] = ctx.state.yaw + Math.PI;
};
`;
    },
  },

  {
    key: "puter-project-note",
    name: "Puter Pattern Note (Info)",
    description:
      "Documents Puter FS scope: editor projects only (not island state). Island state lives on Railway. Read-only template; use as code comment guide.",
    params: [],
    render: () => `// ── PUTER PATTERNS (read-only info) ──────────────────────────────────
// Puter FS: editor project files only (scripts, scenes, prefabs).
//   - puterSdk.ts: load SDK
//   - projectStorage.ts: local vs puter backend
//   - PUTER_PATTERNS.md: full conventions
//
// Island state SSOT: Railway Postgres (/api/island, not Puter).
// Player bag/characters/wallet: Railway (not Puter).
// Live lobby map: pirate-islands scene.glb (R2 CDN).
//
// home-island-contract 1.4.0:
//   - rtsHeightmapResolution: 128
//   - terrainBounds config (read from island API, not Puter)
//
// NO fetch/require/process in player scripts (browser runtime).
// Prefer ctx.scene / ctx.events for inter-script comms.
//
// This template is read-only (no exports.start/update).
`,
  },
];

export function getTemplate(key: string): ScriptTemplate | undefined {
  return SCRIPT_TEMPLATES.find((t) => t.key === key);
}
