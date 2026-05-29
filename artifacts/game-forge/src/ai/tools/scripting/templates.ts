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
];

export function getTemplate(key: string): ScriptTemplate | undefined {
  return SCRIPT_TEMPLATES.find((t) => t.key === key);
}
