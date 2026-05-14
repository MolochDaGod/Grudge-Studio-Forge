/**
 * Built-in RTS behaviors (PR-1 of the Warcraft-2-style RTS conversion).
 *
 * These ship as JS source strings so they compile through the same
 * `getCompiledScript` pipeline as user scripts and `deathmatchBehaviors`.
 * Addressed by the `behavior` field on {@link SceneEntity}.
 *
 *   • `rts-peon` — worker. Auto-shuttles between the nearest neutral
 *     resource node (matching `entity.rts.faction === "neutral"` and
 *     having `rts.resource`) and the nearest friendly `town_hall`.
 *     Each round trip carries `CARRY_CAPACITY` of the resource, emits
 *     a scene-level `rts:deposit` event the gamemode collects.
 *
 *   • `rts-footman` — combat unit (covers footman/archer/mage; ranged
 *     vs melee chosen from `entity.rts.attackKind`-equivalent stats
 *     baked into `entity.userData`). Auto-targets the nearest enemy-
 *     faction unit/building within sight; chases and attacks on
 *     cooldown. Damage routed through `damage` scene messages so the
 *     gamemode can detect town_hall destruction.
 *
 *   • `rts-gamemode` — single hidden manager. Seeds per-faction
 *     resources, listens for `rts:deposit` and `rts:damage`, publishes
 *     `rts:resources` to GameBus for the HUD pill, declares win/lose
 *     when either town_hall HP reaches 0.
 */

// ──────────────────────────────────────────────────────────────────────
// Peon
// ──────────────────────────────────────────────────────────────────────

const RTS_PEON = String.raw`
const CARRY_CAPACITY = 10;
const HARVEST_TIME   = 1.5;     // seconds at the node
const DEPOSIT_TIME   = 0.4;     // seconds at the town hall
const MOVE_SPEED     = 4.0;
const ARRIVE_DIST    = 1.4;

function findNearestResource(entity, ctx) {
  let best = null;
  let bestD = Infinity;
  ctx.scene.findAll(function(e) {
    if (!e || !e.rts || !e.rts.resource) return false;
    if (e.rts.resource.amount <= 0) return false;
    return true;
  }).forEach(function(e) {
    const dx = e.position[0] - entity.position[0];
    const dz = e.position[2] - entity.position[2];
    const d = dx*dx + dz*dz;
    if (d < bestD) { bestD = d; best = e; }
  });
  return best;
}
function findNearestTownHall(entity, ctx, faction) {
  let best = null;
  let bestD = Infinity;
  ctx.scene.findAll(function(e) {
    return e && e.rts && e.rts.faction === faction && e.rts.building === "town_hall";
  }).forEach(function(e) {
    const dx = e.position[0] - entity.position[0];
    const dz = e.position[2] - entity.position[2];
    const d = dx*dx + dz*dz;
    if (d < bestD) { bestD = d; best = e; }
  });
  return best;
}
function moveToward(entity, ctx, tx, tz, speed) {
  const dx = tx - entity.position[0];
  const dz = tz - entity.position[2];
  const d  = Math.sqrt(dx*dx + dz*dz);
  if (d < 0.001) return 0;
  const step = Math.min(d, speed * ctx.time.delta);
  entity.position[0] += (dx / d) * step;
  entity.position[2] += (dz / d) * step;
  entity.rotation[1] = Math.atan2(dx, dz);
  return d - step;
}

exports.start = function(entity, ctx) {
  ctx.state.fsm = "SEEK_RESOURCE";
  ctx.state.timer = 0;
  ctx.state.targetId = null;
  if (!entity.rts) entity.rts = { faction: "player", unit: "peon", hp: 40, maxHp: 40 };
  // Peons take damage like any combat unit so a footman attacking one
  // actually kills it (the gamemode listens for rts:killed on units too).
  ctx.scene.on("damage", function(payload, fromId) {
    if (!entity.rts) return;
    const dmg = payload && typeof payload.amount === "number" ? payload.amount : 5;
    entity.rts.hp = Math.max(0, entity.rts.hp - dmg);
    ctx.events.emit("rts:damage", { id: entity.id, faction: entity.rts.faction, hp: entity.rts.hp, fromId: fromId });
    if (entity.rts.hp <= 0) {
      ctx.events.emit("rts:killed", { id: entity.id, faction: entity.rts.faction, fromId: fromId });
    }
  });
};

exports.update = function(entity, ctx) {
  const faction = entity.rts && entity.rts.faction || "player";
  if (entity.rts && entity.rts.hp <= 0) return;

  switch (ctx.state.fsm) {
    case "SEEK_RESOURCE": {
      const node = ctx.state.targetId ? ctx.scene.find(ctx.state.targetId) : findNearestResource(entity, ctx);
      if (!node) return;
      ctx.state.targetId = node.id;
      const remaining = moveToward(entity, ctx, node.position[0], node.position[2], MOVE_SPEED);
      if (remaining < ARRIVE_DIST) {
        ctx.state.fsm = "HARVEST";
        ctx.state.timer = ctx.time.elapsed + HARVEST_TIME;
      }
      break;
    }
    case "HARVEST": {
      if (ctx.time.elapsed >= ctx.state.timer) {
        const node = ctx.scene.find(ctx.state.targetId);
        if (!node || !node.rts || !node.rts.resource || node.rts.resource.amount <= 0) {
          ctx.state.targetId = null;
          ctx.state.fsm = "SEEK_RESOURCE";
          break;
        }
        const take = Math.min(CARRY_CAPACITY, node.rts.resource.amount);
        node.rts.resource.amount -= take;
        entity.rts.carrying = { kind: node.rts.resource.kind, amount: take };
        ctx.state.depositKind = node.rts.resource.kind;
        ctx.state.fsm = "RETURN";
      }
      break;
    }
    case "RETURN": {
      const hall = findNearestTownHall(entity, ctx, faction);
      if (!hall) { ctx.state.fsm = "SEEK_RESOURCE"; return; }
      const remaining = moveToward(entity, ctx, hall.position[0], hall.position[2], MOVE_SPEED);
      if (remaining < ARRIVE_DIST + 1.0) {
        ctx.state.fsm = "DEPOSIT";
        ctx.state.timer = ctx.time.elapsed + DEPOSIT_TIME;
      }
      break;
    }
    case "DEPOSIT": {
      if (ctx.time.elapsed >= ctx.state.timer) {
        const carry = entity.rts.carrying;
        if (carry && carry.amount > 0) {
          ctx.events.emit("rts:deposit", { faction: faction, kind: carry.kind, amount: carry.amount, fromId: entity.id });
        }
        entity.rts.carrying = undefined;
        ctx.state.fsm = "SEEK_RESOURCE";
      }
      break;
    }
  }
};
`;

// ──────────────────────────────────────────────────────────────────────
// Footman / combat unit
// ──────────────────────────────────────────────────────────────────────

const RTS_FOOTMAN = String.raw`
const SIGHT_RANGE     = 22;
const DEFAULT_RANGE   = 1.6;
const DEFAULT_DAMAGE  = 12;
const DEFAULT_SPEED   = 4.5;
const ATTACK_CD       = 1.2;
const TARGET_RESCAN   = 0.4;     // seconds between target re-scans

function statsOf(entity) {
  // Stats are baked into entity.rts.stats by the template builder so
  // the script doesn't have to know about RACE_LOADOUTS at runtime.
  const u = (entity.rts && entity.rts.stats) || {};
  return {
    range: typeof u.range === "number" ? u.range : DEFAULT_RANGE,
    dmg:   typeof u.dmg   === "number" ? u.dmg   : DEFAULT_DAMAGE,
    speed: typeof u.speed === "number" ? u.speed : DEFAULT_SPEED,
  };
}
function findNearestEnemy(entity, ctx, faction) {
  let best = null;
  let bestD = Infinity;
  ctx.scene.findAll(function(e) {
    if (!e || !e.rts || !e.rts.faction) return false;
    if (e.rts.faction === faction || e.rts.faction === "neutral") return false;
    if (e.rts.hp !== undefined && e.rts.hp <= 0) return false;
    return true;
  }).forEach(function(e) {
    const dx = e.position[0] - entity.position[0];
    const dz = e.position[2] - entity.position[2];
    const d = dx*dx + dz*dz;
    if (d < bestD) { bestD = d; best = e; }
  });
  if (best && bestD <= SIGHT_RANGE * SIGHT_RANGE) return best;
  return null;
}
function moveToward(entity, ctx, tx, tz, speed) {
  const dx = tx - entity.position[0];
  const dz = tz - entity.position[2];
  const d  = Math.sqrt(dx*dx + dz*dz);
  if (d < 0.001) return 0;
  const step = Math.min(d, speed * ctx.time.delta);
  entity.position[0] += (dx / d) * step;
  entity.position[2] += (dz / d) * step;
  entity.rotation[1] = Math.atan2(dx, dz);
  return d - step;
}

exports.start = function(entity, ctx) {
  ctx.state.lastAttack = -999;
  ctx.state.lastScan = -999;
  ctx.state.targetId = null;
  if (!entity.rts) entity.rts = { faction: "player", unit: "footman", hp: 90, maxHp: 90 };
  ctx.scene.on("damage", function(payload, fromId) {
    if (!entity.rts) return;
    const dmg = payload && typeof payload.amount === "number" ? payload.amount : 5;
    entity.rts.hp = Math.max(0, entity.rts.hp - dmg);
    ctx.events.emit("rts:damage", { id: entity.id, faction: entity.rts.faction, hp: entity.rts.hp, fromId: fromId });
    if (entity.rts.hp <= 0) {
      ctx.events.emit("rts:killed", { id: entity.id, faction: entity.rts.faction, fromId: fromId });
    }
  });
};

exports.update = function(entity, ctx) {
  if (!entity.rts || entity.rts.hp <= 0) return;
  const faction = entity.rts.faction;
  const s = statsOf(entity);

  // Re-scan target periodically, or immediately if we have none / it died.
  let target = ctx.state.targetId ? ctx.scene.find(ctx.state.targetId) : null;
  const targetDead = !target || (target.rts && target.rts.hp !== undefined && target.rts.hp <= 0);
  if (targetDead || (ctx.time.elapsed - ctx.state.lastScan) > TARGET_RESCAN) {
    ctx.state.lastScan = ctx.time.elapsed;
    target = findNearestEnemy(entity, ctx, faction);
    ctx.state.targetId = target ? target.id : null;
  }
  if (!target) return;

  const dx = target.position[0] - entity.position[0];
  const dz = target.position[2] - entity.position[2];
  const dist = Math.sqrt(dx*dx + dz*dz);

  if (dist > s.range) {
    moveToward(entity, ctx, target.position[0], target.position[2], s.speed);
  } else {
    if ((ctx.time.elapsed - ctx.state.lastAttack) >= ATTACK_CD) {
      ctx.state.lastAttack = ctx.time.elapsed;
      ctx.scene.send(target.id, "damage", { amount: s.dmg, fromId: entity.id });
      entity.rotation[1] = Math.atan2(dx, dz);
    }
  }
};
`;

// ──────────────────────────────────────────────────────────────────────
// Gamemode manager
// ──────────────────────────────────────────────────────────────────────

const RTS_GAMEMODE = String.raw`
const STARTING = { gold: 400, wood: 200 };

function publish(ctx) {
  ctx.events.emit("rts:resources", {
    player: ctx.state.player,
    enemy:  ctx.state.enemy,
  });
}

exports.start = function(entity, ctx) {
  ctx.state.player = { gold: STARTING.gold, wood: STARTING.wood };
  ctx.state.enemy  = { gold: STARTING.gold, wood: STARTING.wood };
  ctx.state.over   = false;
  publish(ctx);

  ctx.events.on("rts:deposit", function(payload) {
    if (!payload || ctx.state.over) return;
    const f = payload.faction;
    const k = payload.kind;
    const a = payload.amount || 0;
    if ((f !== "player" && f !== "enemy") || (k !== "gold" && k !== "wood")) return;
    ctx.state[f][k] += a;
    publish(ctx);
  });

  ctx.events.on("rts:killed", function(payload) {
    if (!payload || ctx.state.over) return;
    const dead = ctx.scene.find(payload.id);
    if (!dead || !dead.rts || dead.rts.building !== "town_hall") return;
    ctx.state.over = true;
    const won = dead.rts.faction === "enemy";
    ctx.events.emit(won ? "win" : "lose", { reason: "town_hall_destroyed" });
  });
};
`;

// ──────────────────────────────────────────────────────────────────────
// Building (passive damage receiver — town halls etc.)
// ──────────────────────────────────────────────────────────────────────

const RTS_BUILDING = String.raw`
exports.start = function(entity, ctx) {
  if (!entity.rts) {
    entity.rts = { faction: "neutral", building: "town_hall", hp: 1500, maxHp: 1500 };
  }
  // Buildings are static damage receivers — the footman script sends
  // "damage" via scene.send(target.id, ...). Without this listener,
  // attacks on the town hall would no-op and the gamemode win/lose
  // condition (rts:killed → town_hall_destroyed) would never fire.
  ctx.scene.on("damage", function(payload, fromId) {
    if (!entity.rts) return;
    if (entity.rts.hp <= 0) return;
    const dmg = payload && typeof payload.amount === "number" ? payload.amount : 5;
    entity.rts.hp = Math.max(0, entity.rts.hp - dmg);
    ctx.events.emit("rts:damage", { id: entity.id, faction: entity.rts.faction, hp: entity.rts.hp, fromId: fromId });
    if (entity.rts.hp <= 0) {
      ctx.events.emit("rts:killed", { id: entity.id, faction: entity.rts.faction, fromId: fromId });
    }
  });
};
exports.update = function() {};
`;

export const RTS_BEHAVIORS = {
  "rts-peon": RTS_PEON,
  "rts-footman": RTS_FOOTMAN,
  "rts-building": RTS_BUILDING,
  "rts-gamemode": RTS_GAMEMODE,
} as const;
