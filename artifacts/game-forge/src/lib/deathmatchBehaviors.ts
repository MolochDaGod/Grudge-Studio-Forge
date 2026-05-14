/**
 * Built-in deathmatch behaviors.
 *
 * These ship as JS source strings so they can be compiled through the same
 * `getCompiledScript` pipeline that user scripts use. They are NOT stored in
 * `forge_scripts`; they are addressed by the `behavior` field on
 * {@link SceneEntity} and resolved at play-mode start.
 *
 * The behaviors collectively implement the deathmatch loop:
 *
 *   • `player-deathmatch` — handles LMB raycast shooting (camera-relative),
 *     health, taking damage messages, death + respawn at a random spawn point.
 *     Movement comes from PlayCameraController (third-/first-person), so this
 *     script never writes the player's position.
 *
 *   • `enemy-deathmatch` — Yuka-driven AI with a small finite state machine
 *     (PATROL → CHASE → ATTACK / INVESTIGATE / FLEE) and:
 *       - Yuka WanderBehavior + SeekBehavior toggled per state
 *       - Manual separation overlay so enemies don't clump on the player
 *       - Line-of-sight check via `ctx.scene.castRay` before shooting
 *         (enemies can no longer shoot through walls)
 *       - Group alerting via the global event bus: when one enemy spots
 *         the player, others within `ALERT_RADIUS` switch to INVESTIGATE
 *         on the player's last known position
 *       - Aim leading + accuracy falloff: enemies predict where the
 *         player will be based on tracked velocity, with hit chance
 *         decreasing with distance and target lateral speed
 *       - FLEE state when health below 20%
 *       - Health, death + respawn after `respawnDelay` at a random spawn
 *         point, then re-enables steering.
 *
 *   • `gamemode-deathmatch` — attached to a hidden empty named "GameManager".
 *     Listens to `kill` events from the game bus, tracks player vs. enemy
 *     score, and emits `win`/`lose` when either side reaches `scoreLimit`.
 *
 *   • `spawnpoint` — pure marker behavior; no logic. Lets the other scripts
 *     find spawn points by `behavior === "spawnpoint"`.
 */

import type { LayerName } from "@workspace/scene-schema";
import type { BehaviorKind } from "@/scene/types";
import { RTS_BEHAVIORS } from "./rtsBehaviors";

// ──────────────────────────────────────────────────────────────────────────────
// Player
// ──────────────────────────────────────────────────────────────────────────────

const PLAYER_DEATHMATCH = String.raw`
const FIRE_COOLDOWN      = 0.18;  // seconds between shots
const SHOT_RANGE         = 80;
const DEFAULT_SHOT_DAMAGE = 25;
const HEADSHOT_MULT      = 1.6;   // bonus damage on upper-body hits
const HEADSHOT_OFFSET_Y  = 0.55;  // hit point Y above target center → headshot
const DEFAULT_MAX_HEALTH = 100;

// Resolve per-race tuning against ctx.races (populated from the
// game-forge RACES catalog). Falls back to the deathmatch defaults
// when the entity has no raceId or the catalog is unavailable
// (e.g. in unit tests with a stubbed ctx).
function raceStats(entity, ctx) {
  const r = entity.raceId && ctx.races ? ctx.races[entity.raceId] : null;
  return {
    health: (r && typeof r.health === "number") ? r.health : DEFAULT_MAX_HEALTH,
    damage: (r && typeof r.damage === "number") ? r.damage : DEFAULT_SHOT_DAMAGE,
  };
}

exports.start = function(entity, ctx) {
  const stats = raceStats(entity, ctx);
  ctx.state.maxHealth = stats.health;
  ctx.state.shotDamage = stats.damage;
  const MAX_HEALTH = stats.health;
  ctx.state.health = MAX_HEALTH;
  ctx.state.lastShot = -999;
  ctx.state.dead = false;
  ctx.state.deadUntil = 0;
  ctx.state.score = 0;
  // Tracks RMB-held aim state so we only emit "weaponAim" on transitions
  // (the HUD's DiveAim subscribes and recolors the reticle red).
  ctx.state.aiming = false;
  // Inbox: receive damage from enemies.
  ctx.scene.on("damage", function(payload, fromId) {
    if (ctx.state.dead) return;
    const dmg = (payload && typeof payload.amount === "number") ? payload.amount : 10;
    ctx.state.health = Math.max(0, ctx.state.health - dmg);
    ctx.events.emit("damage", { amount: dmg, health: ctx.state.health, max: MAX_HEALTH });
    if (ctx.state.health <= 0) {
      ctx.state.dead = true;
      ctx.state.deadUntil = ctx.time.elapsed + (ctx.state.respawnDelay || 5);
      // Freeze the body so the camera controller stops driving us. Stays
      // frozen until the resurrection frame's setPosition completes (the
      // setPosition frame-stamps the id in pendingTeleportFrame, also
      // detected by the controller as "externally owned").
      ctx.scene.freeze(entity.id);
      ctx.events.emit("playerDied", { killerId: fromId });
      ctx.events.emit("kill", { killerId: fromId, victimId: entity.id, victimIsPlayer: true });
    }
  });
  // Initial HUD push so health bar renders something on play start.
  ctx.events.emit("playerHealth", { health: ctx.state.health, max: MAX_HEALTH });
  ctx.events.emit("playerScore", { score: 0 });
  // Listen for our own kills (gamemode emits these back so we know to bump score).
  ctx.events.on("kill", function(payload) {
    if (!payload || payload.killerId !== entity.id || payload.victimIsPlayer) return;
    ctx.state.score = (ctx.state.score || 0) + 1;
    ctx.events.emit("playerScore", { score: ctx.state.score });
  });
};

exports.update = function(entity, ctx) {
  const MAX_HEALTH = ctx.state.maxHealth || DEFAULT_MAX_HEALTH;
  const SHOT_DAMAGE = ctx.state.shotDamage || DEFAULT_SHOT_DAMAGE;
  // Respawn handling.
  if (ctx.state.dead) {
    if (ctx.time.elapsed >= ctx.state.deadUntil) {
      ctx.state.dead = false;
      ctx.state.health = MAX_HEALTH;
      const spawns = ctx.scene.findAll(function(e) { return e.name && e.name.indexOf("Spawn_") === 0; });
      if (spawns.length > 0) {
        const sp = spawns[Math.floor(Math.random() * spawns.length)];
        // setPosition frame-stamps entity.id in pendingTeleportFrame for
        // THIS frame — the camera controller's isExternallyOwned() check
        // compares its own frame elapsedTime against the stamp and skips
        // the body write, so the teleport survives. We unfreeze AFTER the
        // teleport call so the controller stays out the same frame.
        ctx.scene.setPosition(entity.id, sp.position);
      }
      ctx.scene.unfreeze(entity.id);
      ctx.events.emit("playerHealth", { health: MAX_HEALTH, max: MAX_HEALTH });
      ctx.events.emit("playerRespawn", {});
    } else {
      ctx.events.emit("playerRespawning", { secondsLeft: Math.ceil(ctx.state.deadUntil - ctx.time.elapsed) });
      return;
    }
  }

  // RMB-held aim → recolor the dive reticle red. Only emit on transitions so
  // we don't spam the bus every frame the button is down.
  const wantAim = !!ctx.input.mouse.right;
  if (wantAim !== ctx.state.aiming) {
    ctx.state.aiming = wantAim;
    ctx.events.emit("weaponAim", { aiming: wantAim });
  }

  // LMB shoot with cooldown.
  if (ctx.input.mouse.left && ctx.time.elapsed - ctx.state.lastShot >= FIRE_COOLDOWN) {
    ctx.state.lastShot = ctx.time.elapsed;
    const origin = ctx.scene.cameraPosition();
    const dir = ctx.scene.cameraDirection();
    const hit = ctx.scene.castRay(origin, dir, SHOT_RANGE, [entity.id], undefined, { requireBlocksProjectiles: true });
    ctx.events.emit("playerShot", { origin: origin, dir: dir, hit: hit });
    if (hit && hit.entityId) {
      // Headshot: hit point Y is meaningfully above the target's center.
      // Works for any humanoid-shaped entity without explicit collider parts.
      const target = ctx.scene.findById(hit.entityId);
      const yOffset = target ? (hit.point[1] - target.position[1]) : 0;
      const headshot = yOffset >= HEADSHOT_OFFSET_Y;
      const dmg = Math.round(SHOT_DAMAGE * (headshot ? HEADSHOT_MULT : 1));
      ctx.scene.send(hit.entityId, "damage", { amount: dmg, fromId: entity.id });
      ctx.events.emit("hit", { entityId: hit.entityId, point: hit.point, headshot: headshot, amount: dmg });
    }
  }
};
`;

// ──────────────────────────────────────────────────────────────────────────────
// Enemy
// ──────────────────────────────────────────────────────────────────────────────

const ENEMY_DEATHMATCH = String.raw`
// ── Tunables ─────────────────────────────────────────────────────────────────
// Per-race overrides arrive via ctx.races[entity.raceId] at start():
//   baseStats.health → MAX_HEALTH
//   baseStats.speed  → SEEK_MAX_SPEED (chase) — wander/flee scale with it
//   baseStats.damage → ATTACK_DAMAGE
// Defaults below are used when the entity has no raceId.
const DEFAULT_MAX_HEALTH    = 60;
const DEFAULT_SEEK_SPEED    = 4.0;
const DEFAULT_ATTACK_DAMAGE = 10;
const PATROL_SPEED_RATIO    = 0.4;   // wander speed = chase * this
const FLEE_SPEED_RATIO      = 1.375; // flee speed  = chase * this (matches old 5.5/4.0)
const VIEW_RANGE      = 28;    // we only "see" the player within this radius
const VIEW_FOV_DOT    = -0.2;  // dot(forward, toPlayer) > this → in front-ish cone (~aware ~110°)
const HEAR_RADIUS     = 14;    // always notice player if this close, regardless of facing
const ATTACK_RANGE    = 18;    // shoot when within
const ATTACK_COOLDOWN = 1.4;   // seconds between shots
const STOP_DISTANCE   = 2.5;   // don't push into the player
const ALERT_RADIUS    = 22;    // when we spot the player, alert allies in this radius
const SEPARATION_R    = 2.5;   // start pushing siblings away within this distance
const SEPARATION_W    = 2.0;   // weight applied to separation force
const FLEE_ENTER_PCT  = 0.20;  // enter FLEE when health below 20%
const FLEE_EXIT_PCT   = 0.50;  // leave FLEE only after recovering above 50% (hysteresis)
const FLEE_SAFE_DIST  = 35;    // target distance from the player while fleeing
const LOS_STAGGER     = 3;     // run line-of-sight raycast every Nth frame per enemy
const SEP_STAGGER     = 2;     // run separation every Nth frame per enemy
const INVESTIGATE_T   = 4.0;   // seconds to look around at last-known before giving up
const EYE_HEIGHT      = 1.5;   // raycast origin offset for LoS checks
const SHOT_VARIANCE   = 0.15;  // base hit-position jitter when player is stationary

// Spread enemies' first attack tick over time so they don't all fire on frame 0.
function rand(min, max) { return min + Math.random() * (max - min); }

// Resolve per-race tuning against ctx.races (populated from the
// game-forge RACES catalog). Falls back to the deathmatch defaults
// when the entity has no raceId.
function raceStats(entity, ctx) {
  const r = entity.raceId && ctx.races ? ctx.races[entity.raceId] : null;
  return {
    health: (r && typeof r.health === "number") ? r.health : DEFAULT_MAX_HEALTH,
    speed:  (r && typeof r.speed  === "number") ? r.speed  : DEFAULT_SEEK_SPEED,
    damage: (r && typeof r.damage === "number") ? r.damage : DEFAULT_ATTACK_DAMAGE,
  };
}

exports.start = function(entity, ctx) {
  const stats = raceStats(entity, ctx);
  ctx.state.maxHealth     = stats.health;
  ctx.state.seekMaxSpeed  = stats.speed;
  ctx.state.attackDamage  = stats.damage;
  const MAX_HEALTH = stats.health;
  ctx.state.health = MAX_HEALTH;
  ctx.state.dead = false;
  ctx.state.deadUntil = 0;
  ctx.state.lastAttack = ctx.time.elapsed - rand(0, ATTACK_COOLDOWN);
  ctx.state.spawnPos = entity.position.slice();

  // Player tracking for aim leading.
  ctx.state.lastPlayerPos = null;       // [x,y,z] from prior frame
  ctx.state.lastPlayerVel = [0, 0, 0];  // smoothed (m/s)

  // FSM: PATROL | CHASE | ATTACK | INVESTIGATE | FLEE
  ctx.state.fsm = "PATROL";
  ctx.state.fsmEnteredAt = ctx.time.elapsed;
  ctx.state.lastSeenPos = null;       // [x,y,z] of last LoS hit on the player
  ctx.state.lastSeenAt  = -999;

  // Stagger expensive per-frame work across enemies so they don't all raycast
  // and scan neighbors on the same tick. Phase is derived from the entity id.
  let h = 0;
  for (let i = 0; i < entity.id.length; i++) h = (h * 31 + entity.id.charCodeAt(i)) | 0;
  ctx.state.tick = 0;
  ctx.state.losPhase = Math.abs(h) % LOS_STAGGER;
  ctx.state.sepPhase = Math.abs(h >> 3) % SEP_STAGGER;
  ctx.state.sees = false;             // last computed LoS result (cached between raycasts)

  // Yuka entity manager + vehicle. Wander when patrolling, seek when chasing/
  // investigating/fleeing — toggle by writing target + .active.
  const yk = ctx.yuka;
  const v = new yk.Vehicle();
  v.position.set(entity.position[0], entity.position[1], entity.position[2]);
  v.maxSpeed = stats.speed;

  ctx.state.seek = new yk.SeekBehavior(new yk.Vector3(0, 0, 0));
  ctx.state.seek.active = false;
  v.steering.add(ctx.state.seek);

  // WanderBehavior may not exist in older Yuka builds — fall back gracefully.
  if (typeof yk.WanderBehavior === "function") {
    ctx.state.wander = new yk.WanderBehavior();
    if (typeof ctx.state.wander.weight === "number") ctx.state.wander.weight = 0.5;
    v.steering.add(ctx.state.wander);
    ctx.state.wander.active = false;
  } else {
    ctx.state.wander = null;
  }

  ctx.state.vehicle = v;
  ctx.state.entityManager = new yk.EntityManager();
  ctx.state.entityManager.add(v);

  // Take damage.
  ctx.scene.on("damage", function(payload, fromId) {
    if (ctx.state.dead) return;
    const dmg = (payload && typeof payload.amount === "number") ? payload.amount : 10;
    ctx.state.health = Math.max(0, ctx.state.health - dmg);
    ctx.events.emit("enemyHit", { entityId: entity.id, health: ctx.state.health, max: MAX_HEALTH });
    // Being shot instantly reveals the shooter — switch to CHASE on the
    // attacker's position even if we couldn't see them.
    const attacker = fromId ? ctx.scene.findById(fromId) : null;
    if (attacker && attacker.position) {
      ctx.state.lastSeenPos = attacker.position.slice();
      ctx.state.lastSeenAt = ctx.time.elapsed;
      if (ctx.state.fsm === "PATROL" || ctx.state.fsm === "INVESTIGATE") {
        setFsm(ctx, "CHASE");
      }
    }
    if (ctx.state.health <= 0) {
      ctx.state.dead = true;
      ctx.state.deadUntil = ctx.time.elapsed + (ctx.state.respawnDelay || 5);
      // Hide the corpse out of the way until respawn.
      ctx.scene.setPosition(entity.id, [entity.position[0], -200, entity.position[2]]);
      ctx.events.emit("kill", { killerId: fromId, victimId: entity.id, victimIsPlayer: false });
    }
  });

  // Group alerting — when an ally broadcasts a sighting, switch to
  // INVESTIGATE if we're idle and within range.
  ctx.events.on("enemyAlert", function(payload) {
    if (!payload || ctx.state.dead) return;
    if (payload.fromId === entity.id) return;             // don't react to ourselves
    if (ctx.state.fsm === "ATTACK" || ctx.state.fsm === "FLEE") return; // already engaged
    const dx = entity.position[0] - payload.at[0];
    const dz = entity.position[2] - payload.at[2];
    if (dx * dx + dz * dz > ALERT_RADIUS * ALERT_RADIUS) return;
    ctx.state.lastSeenPos = payload.at.slice();
    ctx.state.lastSeenAt = ctx.time.elapsed;
    setFsm(ctx, "INVESTIGATE");
  });
};

// ── Helpers (defined inside the script string so they share scope) ──────────

function setFsm(ctx, next) {
  if (ctx.state.fsm === next) return;
  ctx.state.fsm = next;
  ctx.state.fsmEnteredAt = ctx.time.elapsed;
  ctx.events.emit("enemyFsm", { state: next });
}

function setSteeringMode(ctx, mode, targetX, targetY, targetZ, speed) {
  // mode: "seek" | "wander" | "stop"
  ctx.state.vehicle.maxSpeed = speed;
  ctx.state.seek.active = (mode === "seek");
  if (ctx.state.wander) ctx.state.wander.active = (mode === "wander");
  if (mode === "seek") {
    ctx.state.seek.target.set(targetX, targetY, targetZ);
  } else if (mode === "stop") {
    ctx.state.vehicle.velocity.set(0, 0, 0);
  }
}

// True if we have unobstructed sight of the player AND they're within VIEW_RANGE
// (or HEAR_RADIUS regardless of facing).
function canSeePlayer(entity, ctx, player) {
  const dx = player.position[0] - entity.position[0];
  const dy = (player.position[1] + EYE_HEIGHT * 0.5) - (entity.position[1] + EYE_HEIGHT);
  const dz = player.position[2] - entity.position[2];
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist > VIEW_RANGE) return false;

  // Horizontal facing test (skip if very close — we always notice point-blank).
  if (dist > HEAR_RADIUS) {
    const yaw = entity.rotation[1] || 0;
    // Forward vector for our convention: rotation[1] yaw → (sin(yaw), 0, cos(yaw))
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const tx = dx / Math.max(0.001, Math.hypot(dx, dz));
    const tz = dz / Math.max(0.001, Math.hypot(dx, dz));
    const dot = fx * tx + fz * tz;
    if (dot < VIEW_FOV_DOT) return false;
  }

  // Raycast from eye → player's torso.
  const origin = [
    entity.position[0],
    entity.position[1] + EYE_HEIGHT,
    entity.position[2],
  ];
  const len = Math.max(0.001, dist);
  const dir = [dx / len, dy / len, dz / len];
  const hit = ctx.scene.castRay(origin, dir, dist + 0.5, [entity.id], undefined, { requireBlocksLineOfSight: true });
  // No hit = clear line; if we did hit, it must be the player itself.
  return !hit || hit.entityId === player.id;
}

// Predict where the player will be after 'flightTime' seconds, blended with
// accuracy noise. Returns [x,y,z]. Higher accuracyFalloff means more spread.
function predictPlayerHit(player, vel, flightTime, accuracyFalloff) {
  const px = player.position[0] + vel[0] * flightTime;
  const py = player.position[1] + vel[1] * flightTime;
  const pz = player.position[2] + vel[2] * flightTime;
  const noise = SHOT_VARIANCE + accuracyFalloff;
  return [
    px + (Math.random() - 0.5) * noise * 2,
    py,
    pz + (Math.random() - 0.5) * noise * 2,
  ];
}

// Apply manual separation from sibling enemies into vehicle.velocity. Uses a
// simple inverse-distance push so two enemies converging on the same target
// arc around each other instead of stacking.
function applySeparation(entity, ctx) {
  const others = ctx.scene.findAll(function(e) {
    return e.behavior === "enemy-deathmatch" && e.id !== entity.id;
  });
  let sx = 0, sz = 0, n = 0;
  for (let i = 0; i < others.length; i++) {
    const o = others[i];
    const ox = entity.position[0] - o.position[0];
    const oz = entity.position[2] - o.position[2];
    const d2 = ox * ox + oz * oz;
    if (d2 > 0 && d2 < SEPARATION_R * SEPARATION_R) {
      const f = 1 / Math.max(0.5, Math.sqrt(d2));
      sx += ox * f;
      sz += oz * f;
      n++;
    }
  }
  if (n > 0) {
    ctx.state.vehicle.velocity.x += sx * SEPARATION_W;
    ctx.state.vehicle.velocity.z += sz * SEPARATION_W;
  }
}

exports.update = function(entity, ctx) {
  const MAX_HEALTH    = ctx.state.maxHealth     || DEFAULT_MAX_HEALTH;
  const SEEK_MAX_SPEED = ctx.state.seekMaxSpeed || DEFAULT_SEEK_SPEED;
  const PATROL_SPEED   = SEEK_MAX_SPEED * PATROL_SPEED_RATIO;
  const FLEE_SPEED     = SEEK_MAX_SPEED * FLEE_SPEED_RATIO;
  const ATTACK_DAMAGE  = ctx.state.attackDamage || DEFAULT_ATTACK_DAMAGE;
  if (ctx.state.dead) {
    if (ctx.time.elapsed >= ctx.state.deadUntil) {
      ctx.state.dead = false;
      ctx.state.health = MAX_HEALTH;
      const spawns = ctx.scene.findAll(function(e) { return e.name && e.name.indexOf("Spawn_") === 0; });
      const target = spawns.length > 0
        ? spawns[Math.floor(Math.random() * spawns.length)].position
        : ctx.state.spawnPos;
      ctx.scene.setPosition(entity.id, target);
      ctx.state.vehicle.position.set(target[0], target[1], target[2]);
      ctx.state.vehicle.velocity.set(0, 0, 0);
      setFsm(ctx, "PATROL");
    }
    return;
  }

  const player = ctx.scene.find("Player");
  if (!player) return;

  // Track player velocity for aim leading.
  if (ctx.state.lastPlayerPos) {
    const vx = (player.position[0] - ctx.state.lastPlayerPos[0]) / Math.max(0.001, ctx.time.delta);
    const vy = (player.position[1] - ctx.state.lastPlayerPos[1]) / Math.max(0.001, ctx.time.delta);
    const vz = (player.position[2] - ctx.state.lastPlayerPos[2]) / Math.max(0.001, ctx.time.delta);
    // Single-pole smoothing so a single-frame teleport (respawn) doesn't poison.
    ctx.state.lastPlayerVel[0] = ctx.state.lastPlayerVel[0] * 0.7 + vx * 0.3;
    ctx.state.lastPlayerVel[1] = ctx.state.lastPlayerVel[1] * 0.7 + vy * 0.3;
    ctx.state.lastPlayerVel[2] = ctx.state.lastPlayerVel[2] * 0.7 + vz * 0.3;
  }
  ctx.state.lastPlayerPos = player.position.slice();

  // Distance to player (horizontal).
  const dx = player.position[0] - entity.position[0];
  const dz = player.position[2] - entity.position[2];
  const dist = Math.sqrt(dx * dx + dz * dz);

  // Sense the player. Raycasts are expensive; only re-check every Nth frame
  // per-enemy and cache the result on state. Phase is initialized in start()
  // so that a wave of enemies doesn't all raycast on the same tick.
  ctx.state.tick = (ctx.state.tick | 0) + 1;
  if ((ctx.state.tick % LOS_STAGGER) === ctx.state.losPhase) {
    ctx.state.sees = canSeePlayer(entity, ctx, player);
  }
  const sees = ctx.state.sees;
  if (sees) {
    const wasAware = ctx.state.lastSeenAt > 0 && (ctx.time.elapsed - ctx.state.lastSeenAt) < 0.5;
    ctx.state.lastSeenPos = player.position.slice();
    ctx.state.lastSeenAt = ctx.time.elapsed;
    // First-time spotting → broadcast alert to allies.
    if (!wasAware && (ctx.state.fsm === "PATROL" || ctx.state.fsm === "INVESTIGATE")) {
      ctx.events.emit("enemyAlert", { fromId: entity.id, at: player.position.slice() });
    }
  }

  // ── FSM transitions ───────────────────────────────────────────────────────
  const healthPct = ctx.state.health / MAX_HEALTH;
  // Enter FLEE strictly on health (not distance). Exit only after recovering
  // health past FLEE_EXIT_PCT — using only the entry threshold here would
  // race the FLEE-state's own exit rule and thrash PATROL/FLEE every frame.
  if (healthPct < FLEE_ENTER_PCT && ctx.state.fsm !== "FLEE") {
    setFsm(ctx, "FLEE");
  } else {
    switch (ctx.state.fsm) {
      case "PATROL":
        if (sees) setFsm(ctx, dist < ATTACK_RANGE ? "ATTACK" : "CHASE");
        break;
      case "CHASE":
        if (sees && dist < ATTACK_RANGE) setFsm(ctx, "ATTACK");
        else if (!sees && (ctx.time.elapsed - ctx.state.lastSeenAt) > 0.6) setFsm(ctx, "INVESTIGATE");
        break;
      case "ATTACK":
        if (!sees || dist > ATTACK_RANGE * 1.15) setFsm(ctx, sees ? "CHASE" : "INVESTIGATE");
        break;
      case "INVESTIGATE":
        if (sees) setFsm(ctx, dist < ATTACK_RANGE ? "ATTACK" : "CHASE");
        else if ((ctx.time.elapsed - ctx.state.fsmEnteredAt) > INVESTIGATE_T) setFsm(ctx, "PATROL");
        break;
      case "FLEE":
        // Exit FLEE only when health has recovered (hysteresis). Distance
        // alone must not break us out, or we'll oscillate the moment we
        // reach FLEE_SAFE_DIST while still critically wounded.
        if (healthPct >= FLEE_EXIT_PCT) setFsm(ctx, "PATROL");
        break;
    }
  }

  // ── Per-state action ──────────────────────────────────────────────────────
  switch (ctx.state.fsm) {
    case "PATROL": {
      if (ctx.state.wander) {
        setSteeringMode(ctx, "wander", 0, 0, 0, PATROL_SPEED);
      } else {
        // Fallback: drift slowly back toward our spawn point.
        const sp = ctx.state.spawnPos;
        setSteeringMode(ctx, "seek", sp[0], entity.position[1], sp[2], PATROL_SPEED);
      }
      break;
    }
    case "CHASE": {
      const t = ctx.state.lastSeenPos || player.position;
      setSteeringMode(ctx, "seek", t[0], entity.position[1], t[2], SEEK_MAX_SPEED);
      break;
    }
    case "ATTACK": {
      // Stop and shoot — but maintain a small approach if we're outside
      // STOP_DISTANCE so we don't freeze too far away.
      if (dist > STOP_DISTANCE) {
        setSteeringMode(ctx, "seek", player.position[0], entity.position[1], player.position[2], SEEK_MAX_SPEED * 0.5);
      } else {
        setSteeringMode(ctx, "stop", 0, 0, 0, 0);
      }
      // Fire on cooldown if we still have LoS.
      if (sees && (ctx.time.elapsed - ctx.state.lastAttack) >= ATTACK_COOLDOWN) {
        ctx.state.lastAttack = ctx.time.elapsed;
        // Aim lead: assume a bullet flight time of dist / 80 (matches player's SHOT_RANGE).
        const flightTime = Math.min(0.4, dist / 80);
        // Accuracy degrades with distance and target lateral speed.
        const playerSpeed = Math.hypot(ctx.state.lastPlayerVel[0], ctx.state.lastPlayerVel[2]);
        const falloff = (dist / ATTACK_RANGE) * 0.6 + playerSpeed * 0.05;
        const aimAt = predictPlayerHit(player, ctx.state.lastPlayerVel, flightTime, falloff);
        const ax = aimAt[0] - entity.position[0];
        const az = aimAt[2] - entity.position[2];
        const aimDist = Math.hypot(ax, az);
        // Hit chance: 1.0 inside SHOT_VARIANCE worth of jitter, scales down with falloff.
        const hitChance = Math.max(0.25, 1 - falloff * 0.7);
        if (Math.random() < hitChance) {
          ctx.scene.send(player.id, "damage", { amount: ATTACK_DAMAGE, fromId: entity.id });
          ctx.events.emit("enemyAttack", { fromId: entity.id, targetId: player.id, hit: true });
        } else {
          ctx.events.emit("enemyAttack", { fromId: entity.id, targetId: player.id, hit: false, missAt: aimAt });
        }
        // Face the shot.
        if (aimDist > 0.001) entity.rotation[1] = Math.atan2(ax, az);
      }
      break;
    }
    case "INVESTIGATE": {
      const t = ctx.state.lastSeenPos || ctx.state.spawnPos;
      setSteeringMode(ctx, "seek", t[0], entity.position[1], t[2], SEEK_MAX_SPEED * 0.7);
      break;
    }
    case "FLEE": {
      // Run directly away from the player, projected to a spot FLEE_SAFE_DIST out.
      const len = Math.max(0.001, dist);
      const fx = entity.position[0] - dx / len * FLEE_SAFE_DIST;
      const fz = entity.position[2] - dz / len * FLEE_SAFE_DIST;
      setSteeringMode(ctx, "seek", fx, entity.position[1], fz, FLEE_SPEED);
      break;
    }
  }

  // ── Step Yuka, apply separation, write back ───────────────────────────────
  ctx.state.vehicle.position.set(entity.position[0], entity.position[1], entity.position[2]);
  ctx.state.entityManager.update(ctx.time.delta);
  // Separation does a findAll + neighbor scan; rotate which enemies pay that
  // cost each frame so the work amortises across SEP_STAGGER frames.
  if ((ctx.state.tick % SEP_STAGGER) === ctx.state.sepPhase) {
    applySeparation(entity, ctx);
  }

  entity.position[0] = ctx.state.vehicle.position.x;
  entity.position[2] = ctx.state.vehicle.position.z;

  // Face direction of travel (unless we just oriented for a shot).
  if (ctx.state.fsm !== "ATTACK") {
    const vxf = ctx.state.vehicle.velocity.x;
    const vzf = ctx.state.vehicle.velocity.z;
    if (Math.abs(vxf) + Math.abs(vzf) > 0.05) {
      entity.rotation[1] = Math.atan2(vxf, vzf);
    }
  }
};
`;

// ──────────────────────────────────────────────────────────────────────────────
// Game manager
// ──────────────────────────────────────────────────────────────────────────────

const GAMEMODE_DEATHMATCH = String.raw`
exports.start = function(entity, ctx) {
  ctx.state.playerScore = 0;
  ctx.state.enemyScore = 0;
  ctx.state.scoreLimit = ctx.state.scoreLimit || 10;
  ctx.state.gameOver = false;

  ctx.events.on("kill", function(payload) {
    if (ctx.state.gameOver || !payload) return;
    if (payload.victimIsPlayer) {
      ctx.state.enemyScore += 1;
      ctx.events.emit("enemyScore", { score: ctx.state.enemyScore });
    } else {
      ctx.state.playerScore += 1;
      ctx.events.emit("playerScore", { score: ctx.state.playerScore });
    }
    if (ctx.state.playerScore >= ctx.state.scoreLimit) {
      ctx.state.gameOver = true;
      ctx.events.emit("win", { score: ctx.state.playerScore });
    } else if (ctx.state.enemyScore >= ctx.state.scoreLimit) {
      ctx.state.gameOver = true;
      ctx.events.emit("lose", { score: ctx.state.enemyScore });
    }
  });

  ctx.events.emit("playerScore", { score: 0 });
  ctx.events.emit("enemyScore", { score: 0 });
};
`;

// ──────────────────────────────────────────────────────────────────────────────
// Pickup trigger — starter behavior demonstrating the trigger event API
// ──────────────────────────────────────────────────────────────────────────────

const PICKUP_TRIGGER = String.raw`
// Despawn this entity when a body named "Player" — or any body on the
// "Player" layer — overlaps its sensor volume. Place this on an entity
// that lives on the "Trigger" layer (so it spawns as a Rapier sensor)
// and gives the user a one-line example of trigger / overlap reactions.
exports.start = function(entity, ctx) {
  ctx.scene.onEnterTrigger(function(other) {
    var isPlayer = other.otherName === "Player" || other.otherLayer === "Player";
    if (!isPlayer) return;
    ctx.events.emit("pickup", { id: entity.id, name: entity.name, by: other.otherId });
    ctx.scene.despawn(entity.id);
  });
};
`;

// ──────────────────────────────────────────────────────────────────────────────
// RPG Player — quieter, melee-flavored sibling of player-deathmatch.
//
//   • LMB swings a short-range melee cone (raycast from camera, capped to
//     MELEE_RANGE), deals MELEE_DAMAGE per hit. No projectile range, no
//     ammo, no headshot multiplier.
//   • E key emits a scene-level `interact` event that nearby NPCs / pickup
//     scripts can subscribe to (passes the closest interactable id within
//     INTERACT_RANGE in front of the camera).
//   • Standard health / damage HUD wiring (`playerHealth`, `damage`).
//   • On death we freeze the body, emit `playerDied`, but do NOT respawn
//     and do NOT emit `kill` (so the deathmatch scoreboard stays silent).
// ──────────────────────────────────────────────────────────────────────────────

const PLAYER_RPG = String.raw`
const SWING_COOLDOWN  = 0.45;  // seconds between melee swings
const MELEE_RANGE     = 2.4;   // metres reach of the swing
const MELEE_DAMAGE    = 22;
const INTERACT_RANGE  = 3.0;   // metres for the E-key interact pick
const MAX_HEALTH      = 100;

exports.start = function(entity, ctx) {
  ctx.state.health = MAX_HEALTH;
  ctx.state.lastSwing = -999;
  // Edge-trigger latch for E so holding the key fires interact exactly once.
  ctx.state.interactLatched = false;
  ctx.state.dead = false;
  // Inbox: receive damage from enemies. RPG variant has no respawn.
  ctx.scene.on("damage", function(payload, fromId) {
    if (ctx.state.dead) return;
    const dmg = (payload && typeof payload.amount === "number") ? payload.amount : 10;
    ctx.state.health = Math.max(0, ctx.state.health - dmg);
    ctx.events.emit("damage", { amount: dmg, health: ctx.state.health, max: MAX_HEALTH });
    if (ctx.state.health <= 0) {
      ctx.state.dead = true;
      // Freeze so the camera controller stops driving the body. We never
      // unfreeze in this behavior — death is permanent for the run.
      ctx.scene.freeze(entity.id);
      // noRespawn flags this as a permanent (RPG-style) death so the HUD
      // can show a "You died" overlay with a Restart button instead of the
      // deathmatch respawn countdown.
      ctx.events.emit("playerDied", { killerId: fromId, noRespawn: true });
    }
  });
  ctx.events.emit("playerHealth", { health: ctx.state.health, max: MAX_HEALTH });
};

exports.update = function(entity, ctx) {
  if (ctx.state.dead) return;

  // E key → emit a scene-level interact event with the closest entity in
  // a short cone in front of the camera. Edge-triggered: emits exactly
  // once per press (must release E before it fires again). NPC / pickup
  // scripts can listen on the bus via ctx.events.on("interact", ...).
  const interactDown = !!(ctx.input.keys && (ctx.input.keys.e || ctx.input.keys.E));
  if (interactDown && !ctx.state.interactLatched) {
    ctx.state.interactLatched = true;
    const origin = ctx.scene.cameraPosition();
    const dir = ctx.scene.cameraDirection();
    const hit = ctx.scene.castRay(origin, dir, INTERACT_RANGE, [entity.id]);
    ctx.events.emit("interact", {
      fromId: entity.id,
      targetId: hit && hit.entityId ? hit.entityId : null,
      point: hit ? hit.point : null,
    });
  } else if (!interactDown && ctx.state.interactLatched) {
    ctx.state.interactLatched = false;
  }

  // LMB melee swing with cooldown — short-range raycast from the camera.
  if (ctx.input.mouse.left && ctx.time.elapsed - ctx.state.lastSwing >= SWING_COOLDOWN) {
    ctx.state.lastSwing = ctx.time.elapsed;
    const origin = ctx.scene.cameraPosition();
    const dir = ctx.scene.cameraDirection();
    const hit = ctx.scene.castRay(origin, dir, MELEE_RANGE, [entity.id], undefined, { requireBlocksProjectiles: true });
    ctx.events.emit("playerSwing", { origin: origin, dir: dir, hit: hit });
    if (hit && hit.entityId) {
      ctx.scene.send(hit.entityId, "damage", { amount: MELEE_DAMAGE, fromId: entity.id });
      ctx.events.emit("hit", { entityId: hit.entityId, point: hit.point, headshot: false, amount: MELEE_DAMAGE });
    }
  }
};
`;

// ──────────────────────────────────────────────────────────────────────────────
// RPG Enemy — peaceful wanderer that becomes hostile only when provoked.
//
//   • Yuka WanderBehavior at PATROL_SPEED until provoked (taking damage
//     OR the player crosses AGGRO_RADIUS — no facing / line-of-sight test;
//     RPG enemies are intentionally simpler than enemy-deathmatch).
//   • Once hostile we chase the player at SEEK_MAX_SPEED and melee-attack
//     at MELEE_RANGE on a cooldown. There is no flee state.
//   • Death is permanent — we hide the corpse and never respawn. No `kill`
//     event is emitted (the deathmatch gamemode would otherwise score it).
// ──────────────────────────────────────────────────────────────────────────────

const ENEMY_RPG = String.raw`
// ── Tunables ─────────────────────────────────────────────────────────────────
const MAX_HEALTH      = 50;
// Per-race animation clip names — mirrors BUILTIN_MODEL_CLIPS in
// lib/builtinModels.ts. We embed the table inline here because behavior
// scripts compile through new Function() and can't import modules.
// Writing a clip name that doesn't exist in the GLB is a safe no-op
// (drei's useAnimations finds no matching action and the heuristic
// fallback in EntityRenderer.LoadedModel runs instead).
// The clip names below match what synthesizeBipedClips in
// lib/proceduralBipedAnimations.ts emits when it detects a Bip001
// rig with zero baked animations (the toon-rts character pack today)
// — so resolution flows: writer → __agentClips → LoadedModel →
// procedural clip → AnimationMixer crossfade. Once the asset pack
// re-exports real locomotion clips into the character GLBs, the
// synthesizer becomes a silent no-op and these names continue to
// resolve to the GLB-baked clips instead.
// Mirrored in lib/builtinModels.ts BUILTIN_MODEL_CLIPS (drift-tested).
const RACE_CLIPS = {
  warrior:       { idle: "idle", walk: "walk", run: "run", attack: "attack", death: "death" },
  dwarf:         { idle: "idle", walk: "walk", run: "run", attack: "attack", death: "death" },
  "frost-dwarf": { idle: "idle", walk: "walk", run: "run", attack: "attack", death: "death" },
  elf:           { idle: "idle", walk: "walk", run: "run", attack: "attack", death: "death" },
  orc:           { idle: "idle", walk: "walk", run: "run", attack: "attack", death: "death" },
  skeleton:      { idle: "idle", walk: "walk", run: "run", attack: "attack", death: "death" }
};
function publishClip(entityId, clip) {
  if (!clip || typeof window === "undefined") return;
  if (!window.__agentClips) window.__agentClips = new Map();
  window.__agentClips.set(entityId, clip);
}
const SEEK_MAX_SPEED  = 3.2;   // m/s when chasing
const PATROL_SPEED    = 1.2;   // m/s when wandering peacefully
const AGGRO_RADIUS    = 8;     // become hostile if player gets this close
const DEAGGRO_RADIUS  = 22;    // give up chase if player escapes this far
const MELEE_RANGE     = 2.0;   // attack reach
const MELEE_COOLDOWN  = 1.6;   // seconds between swings
const MELEE_DAMAGE    = 8;
const STOP_DISTANCE   = 1.6;   // don't push into the player while attacking

function rand(min, max) { return min + Math.random() * (max - min); }

exports.start = function(entity, ctx) {
  ctx.state.health = MAX_HEALTH;
  ctx.state.dead = false;
  ctx.state.hostile = false;          // becomes true on first provocation
  ctx.state.lastAttack = ctx.time.elapsed - rand(0, MELEE_COOLDOWN);
  ctx.state.spawnPos = entity.position.slice();

  // Yuka entity manager + vehicle: wander while peaceful, seek when hostile.
  const yk = ctx.yuka;
  const v = new yk.Vehicle();
  v.position.set(entity.position[0], entity.position[1], entity.position[2]);
  v.maxSpeed = PATROL_SPEED;

  ctx.state.seek = new yk.SeekBehavior(new yk.Vector3(0, 0, 0));
  ctx.state.seek.active = false;
  v.steering.add(ctx.state.seek);

  if (typeof yk.WanderBehavior === "function") {
    ctx.state.wander = new yk.WanderBehavior();
    if (typeof ctx.state.wander.weight === "number") ctx.state.wander.weight = 0.5;
    v.steering.add(ctx.state.wander);
    ctx.state.wander.active = true;   // start peacefully wandering
  } else {
    ctx.state.wander = null;
  }

  ctx.state.vehicle = v;
  ctx.state.entityManager = new yk.EntityManager();
  ctx.state.entityManager.add(v);

  // Take damage — instantly become hostile toward the attacker.
  ctx.scene.on("damage", function(payload, fromId) {
    if (ctx.state.dead) return;
    const dmg = (payload && typeof payload.amount === "number") ? payload.amount : 10;
    ctx.state.health = Math.max(0, ctx.state.health - dmg);
    ctx.events.emit("enemyHit", { entityId: entity.id, health: ctx.state.health, max: MAX_HEALTH });
    ctx.state.hostile = true;
    if (ctx.state.health <= 0) {
      ctx.state.dead = true;
      // Stop steering immediately so the corpse doesn't keep gliding
      // forward while the death clip plays.
      if (ctx.state.seek)   ctx.state.seek.active   = false;
      if (ctx.state.wander) ctx.state.wander.active = false;
      ctx.state.vehicle.velocity.set(0, 0, 0);
      // Publish the death clip up-front so the mesh contorts into the
      // procedural fetal slump even when ragdoll physics aren't
      // available (LoopOnce + clampWhenFinished — see the death
      // branch in EntityRenderer.pickClipName's useFrame). This is
      // the zero-physics fallback; with physics it plays on top of
      // the tumbling capsule, which works because the mixer drives
      // bones while Rapier drives the body's transform.
      if (entity.raceId && RACE_CLIPS[entity.raceId] && RACE_CLIPS[entity.raceId].death) {
        publishClip(entity.id, RACE_CLIPS[entity.raceId].death);
      }
      // Hand the body off to physics: switch to dynamic, unlock
      // rotations, and apply an impulse along killer→victim so the
      // direction of the killing hit influences the fall (a shot
      // from the front knocks the body backward). When the killer
      // isn't resolvable we fall straight down under gravity (zero
      // impulse) instead of an arbitrary push. Intentionally NO
      // "kill" emit — that would feed the deathmatch scoreboard.
      if (typeof ctx.scene.ragdoll === "function") {
        var pushX = 0, pushZ = 0, hasDir = false;
        if (fromId) {
          var killer = ctx.scene.findById(fromId);
          if (killer) {
            pushX = entity.position[0] - killer.position[0];
            pushZ = entity.position[2] - killer.position[2];
            hasDir = (pushX * pushX + pushZ * pushZ) > 1e-4;
          }
        }
        // Small upward kick (Y=0.5) when we have a horizontal push so
        // the body lifts off the ground briefly and tumbles instead of
        // sliding flat. With no direction we send a zero vector — the
        // helper handles that as a pure free-fall under gravity.
        var pushY = hasDir ? 0.5 : 0;
        var force = hasDir ? 7 : 0;
        ctx.scene.ragdoll(entity.id, [pushX, pushY, pushZ], force);
      }
      ctx.events.emit("enemyDied", { entityId: entity.id, killerId: fromId });
    }
  });
};

function setSteeringMode(ctx, mode, targetX, targetY, targetZ, speed) {
  ctx.state.vehicle.maxSpeed = speed;
  ctx.state.seek.active = (mode === "seek");
  if (ctx.state.wander) ctx.state.wander.active = (mode === "wander");
  if (mode === "seek") {
    ctx.state.seek.target.set(targetX, targetY, targetZ);
  } else if (mode === "stop") {
    ctx.state.vehicle.velocity.set(0, 0, 0);
  }
}

exports.update = function(entity, ctx) {
  if (ctx.state.dead) return;

  const player = ctx.scene.find("Player");
  if (!player) return;

  const dx = player.position[0] - entity.position[0];
  const dz = player.position[2] - entity.position[2];
  const dist = Math.sqrt(dx * dx + dz * dz);

  // Provocation: proximity is enough to trigger hostility (no LoS check).
  if (!ctx.state.hostile && dist < AGGRO_RADIUS) {
    ctx.state.hostile = true;
  }
  // Escape: if the player runs far enough away, calm down again.
  if (ctx.state.hostile && dist > DEAGGRO_RADIUS) {
    ctx.state.hostile = false;
  }

  if (!ctx.state.hostile) {
    // Peaceful wander.
    if (ctx.state.wander) {
      setSteeringMode(ctx, "wander", 0, 0, 0, PATROL_SPEED);
    } else {
      const sp = ctx.state.spawnPos;
      setSteeringMode(ctx, "seek", sp[0], entity.position[1], sp[2], PATROL_SPEED);
    }
  } else if (dist > MELEE_RANGE) {
    // Chase.
    setSteeringMode(ctx, "seek", player.position[0], entity.position[1], player.position[2], SEEK_MAX_SPEED);
  } else {
    // In melee range — stop and swing on cooldown.
    if (dist > STOP_DISTANCE) {
      setSteeringMode(ctx, "seek", player.position[0], entity.position[1], player.position[2], SEEK_MAX_SPEED * 0.4);
    } else {
      setSteeringMode(ctx, "stop", 0, 0, 0, 0);
    }
    if ((ctx.time.elapsed - ctx.state.lastAttack) >= MELEE_COOLDOWN) {
      ctx.state.lastAttack = ctx.time.elapsed;
      ctx.scene.send(player.id, "damage", { amount: MELEE_DAMAGE, fromId: entity.id });
      ctx.events.emit("enemyAttack", { fromId: entity.id, targetId: player.id, hit: true });
      // Face the player for the swing.
      if (dist > 0.001) entity.rotation[1] = Math.atan2(dx, dz);
    }
  }

  // Step Yuka, write back position + facing.
  ctx.state.vehicle.position.set(entity.position[0], entity.position[1], entity.position[2]);
  ctx.state.entityManager.update(ctx.time.delta);
  entity.position[0] = ctx.state.vehicle.position.x;
  entity.position[2] = ctx.state.vehicle.position.z;

  const vxf = ctx.state.vehicle.velocity.x;
  const vzf = ctx.state.vehicle.velocity.z;
  const speedXZ = Math.abs(vxf) + Math.abs(vzf);
  if (speedXZ > 0.05) {
    entity.rotation[1] = Math.atan2(vxf, vzf);
  }

  // Per-race animation clip publish: idle while peaceful (or stopped in
  // melee), walk while wandering, run while chasing, attack on the
  // frame we just swung. Skips when the entity has no raceId so legacy
  // non-toon-rts enemies fall through to LoadedModel's idle/loop
  // heuristic.
  const clipsForRace = entity.raceId && RACE_CLIPS[entity.raceId];
  if (clipsForRace) {
    var clip;
    if (ctx.state.dead) {
      clip = clipsForRace.idle;
    } else if (!ctx.state.hostile) {
      clip = speedXZ > 0.05 ? clipsForRace.walk : clipsForRace.idle;
    } else if (dist > MELEE_RANGE) {
      clip = clipsForRace.run;
    } else {
      clip = (ctx.state.lastAttack === ctx.time.elapsed && clipsForRace.attack)
        ? clipsForRace.attack
        : clipsForRace.idle;
    }
    publishClip(entity.id, clip);
  }
};
`;

// ──────────────────────────────────────────────────────────────────────────────
// NPC dialog — friendly conversation popup driven by the player-rpg E key
//
//   • Subscribes to the scene-level `interact` event emitted by player-rpg.
//     When `payload.targetId === entity.id` we fire a `npcDialog` HUD event
//     with the configured line; PlayHUD renders a small speech bubble for
//     a few seconds.
//   • The line of text comes from `entity.npcLine` (set in the scene); a
//     generic "..." fallback keeps the bubble useful even on untagged NPCs.
//   • No movement, health, or other side effects — purely an interaction
//     handler suitable for the rpg-village starter friendlies.
// ──────────────────────────────────────────────────────────────────────────────

const NPC_DIALOG = String.raw`
exports.start = function(entity, ctx) {
  ctx.events.on("interact", function(payload) {
    if (!payload || payload.targetId !== entity.id) return;
    var line = (typeof entity.npcLine === "string" && entity.npcLine.length > 0)
      ? entity.npcLine
      : "...";
    ctx.events.emit("npcDialog", {
      fromId: entity.id,
      name: entity.name,
      line: line,
    });
  });
};
`;

// ──────────────────────────────────────────────────────────────────────────────
// Registry
// ──────────────────────────────────────────────────────────────────────────────

export const BUILTIN_BEHAVIORS: Record<BehaviorKind, string> = {
  "player-deathmatch": PLAYER_DEATHMATCH,
  "enemy-deathmatch": ENEMY_DEATHMATCH,
  "gamemode-deathmatch": GAMEMODE_DEATHMATCH,
  spawnpoint: "// marker — no behavior",
  "pickup-trigger": PICKUP_TRIGGER,
  "player-rpg": PLAYER_RPG,
  "enemy-rpg": ENEMY_RPG,
  "npc-dialog": NPC_DIALOG,
  "rts-peon": RTS_BEHAVIORS["rts-peon"],
  "rts-footman": RTS_BEHAVIORS["rts-footman"],
  "rts-building": RTS_BEHAVIORS["rts-building"],
  "rts-gamemode": RTS_BEHAVIORS["rts-gamemode"],
};

/** Default physics layer per built-in behavior. Lets prefab definitions and
 *  the hierarchy sanitizer tag entities correctly without re-deriving the
 *  role from name/heuristics every time. `null` means "no opinion — leave
 *  whatever the entity already has, or fall back to inferDefaultLayer". */
export const BEHAVIOR_DEFAULT_LAYERS: Record<BehaviorKind, LayerName | null> = {
  "player-deathmatch": "Player",
  "enemy-deathmatch": "NPC",
  // GameManager is a hidden empty marker — keep on Default so it doesn't
  // accidentally appear in physics queries.
  "gamemode-deathmatch": null,
  spawnpoint: "Trigger",
  "pickup-trigger": "Trigger",
  "player-rpg": "Player",
  "enemy-rpg": "NPC",
  "npc-dialog": "NPC",
  // RTS units sit on Player/NPC layers per faction; the template builder
  // assigns them explicitly, so leave inference off here.
  "rts-peon": null,
  "rts-footman": null,
  // Buildings live on Player or NPC depending on faction — assigned by
  // the template builder. Leave inference off here.
  "rts-building": null,
  "rts-gamemode": null,
};
