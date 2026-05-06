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
];

export function getTemplate(key: string): ScriptTemplate | undefined {
  return SCRIPT_TEMPLATES.find((t) => t.key === key);
}
