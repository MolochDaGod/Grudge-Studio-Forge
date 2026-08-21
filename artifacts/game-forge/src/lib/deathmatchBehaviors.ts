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
      const spawns = ctx.scene.findAll(function(e) {
        return e.behavior === "spawnpoint" ||
          (e.name && (e.name.indexOf("Spawn_") === 0 || e.name.indexOf("PlayerSpawn") === 0));
      });
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
      const spawns = ctx.scene.findAll(function(e) {
        return e.behavior === "spawnpoint" ||
          (e.name && (e.name.indexOf("Spawn_") === 0 || e.name.indexOf("EnemySpawn") === 0 || e.name.indexOf("PlayerSpawn") === 0));
      });
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
    const hit = (typeof ctx.scene.meleeVolume === "function")
      ? ctx.scene.meleeVolume(origin, dir, MELEE_RANGE, [entity.id])
      : ctx.scene.castRay(origin, dir, MELEE_RANGE, [entity.id], undefined, { requireBlocksProjectiles: true });
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
// Faction brains — ally / neutral / vendor / boss
// ──────────────────────────────────────────────────────────────────────────────

const ALLY_COMBAT = String.raw`
function isHostileBehavior(b) {
  return b === "enemy-deathmatch" || b === "enemy-rpg" || b === "boss";
}
function findNearestHostile(entity, ctx, maxDist) {
  var best = null, bestD = maxDist || 45;
  var all = ctx.scene.findAll(function(e) {
    return e.id !== entity.id && isHostileBehavior(e.behavior);
  });
  for (var i = 0; i < all.length; i++) {
    var o = all[i];
    var dx = o.position[0] - entity.position[0];
    var dz = o.position[2] - entity.position[2];
    var d = Math.sqrt(dx * dx + dz * dz);
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}
function findPlayer(ctx) {
  var p = ctx.scene.find("Player");
  if (p) return p;
  var list = ctx.scene.findAll(function(e) {
    return e.behavior === "player-deathmatch" || e.behavior === "player-rpg";
  });
  return list[0] || null;
}

const MAX_HEALTH = 120;
const MOVE_SPEED = 5.5;
const ATTACK_RANGE = 2.4;
const ATTACK_COOLDOWN = 0.7;
const ATTACK_DAMAGE = 18;
const SENSE_RANGE = 40;

exports.start = function(entity, ctx) {
  ctx.state.health = MAX_HEALTH;
  ctx.state.maxHealth = MAX_HEALTH;
  ctx.state.dead = false;
  ctx.state.lastAttack = -999;
  ctx.state.faction = "ally";
  ctx.state.role = "ally";
  ctx.scene.on("damage", function(payload, fromId) {
    if (ctx.state.dead) return;
    // Ignore friendly fire from player
    var from = fromId ? ctx.scene.findById(fromId) : null;
    if (from && (from.behavior === "player-deathmatch" || from.behavior === "player-rpg" || from.behavior === "ally")) return;
    var dmg = (payload && typeof payload.amount === "number") ? payload.amount : 10;
    ctx.state.health = Math.max(0, ctx.state.health - dmg);
    if (ctx.state.health <= 0) {
      ctx.state.dead = true;
      ctx.scene.freeze(entity.id);
      ctx.events.emit("kill", { killerId: fromId, victimId: entity.id, victimIsPlayer: false, faction: "ally" });
    }
  });
};

exports.update = function(entity, ctx) {
  if (ctx.state.dead) return;
  var hostile = findNearestHostile(entity, ctx, SENSE_RANGE);
  var player = findPlayer(ctx);
  if (hostile) {
    var dx = hostile.position[0] - entity.position[0];
    var dz = hostile.position[2] - entity.position[2];
    var dist = Math.sqrt(dx * dx + dz * dz) || 0.001;
    if (dist > ATTACK_RANGE) {
      var nx = dx / dist, nz = dz / dist;
      ctx.scene.setPosition(entity.id, [
        entity.position[0] + nx * MOVE_SPEED * ctx.time.delta,
        entity.position[1],
        entity.position[2] + nz * MOVE_SPEED * ctx.time.delta
      ]);
    } else if (ctx.time.elapsed - ctx.state.lastAttack >= ATTACK_COOLDOWN) {
      ctx.state.lastAttack = ctx.time.elapsed;
      ctx.scene.send(hostile.id, "damage", { amount: ATTACK_DAMAGE });
      ctx.events.emit("allyAttack", { fromId: entity.id, targetId: hostile.id, amount: ATTACK_DAMAGE });
    }
    return;
  }
  // Soft follow player when no hostiles
  if (player) {
    var pdx = player.position[0] - entity.position[0];
    var pdz = player.position[2] - entity.position[2];
    var pd = Math.sqrt(pdx * pdx + pdz * pdz);
    if (pd > 6 && pd < 50) {
      ctx.scene.setPosition(entity.id, [
        entity.position[0] + (pdx / pd) * MOVE_SPEED * 0.7 * ctx.time.delta,
        entity.position[1],
        entity.position[2] + (pdz / pd) * MOVE_SPEED * 0.7 * ctx.time.delta
      ]);
    }
  }
};
`;

const NEUTRAL_WANDER = String.raw`
const MAX_HEALTH = 80;
const MOVE_SPEED = 2.2;
const ATTACK_RANGE = 2.0;
const ATTACK_DAMAGE = 8;
const ATTACK_COOLDOWN = 0.9;

exports.start = function(entity, ctx) {
  ctx.state.health = MAX_HEALTH;
  ctx.state.maxHealth = MAX_HEALTH;
  ctx.state.dead = false;
  ctx.state.hostile = false;
  ctx.state.lastAttack = -999;
  ctx.state.faction = "neutral";
  ctx.state.role = "neutral";
  ctx.state.wanderT = 0;
  ctx.state.wanderDir = [Math.random() - 0.5, Math.random() - 0.5];
  ctx.scene.on("damage", function(payload, fromId) {
    if (ctx.state.dead) return;
    var dmg = (payload && typeof payload.amount === "number") ? payload.amount : 10;
    ctx.state.health = Math.max(0, ctx.state.health - dmg);
    ctx.state.hostile = true;
    ctx.state.aggroId = fromId;
    if (ctx.state.health <= 0) {
      ctx.state.dead = true;
      ctx.scene.freeze(entity.id);
      ctx.events.emit("kill", { killerId: fromId, victimId: entity.id, victimIsPlayer: false, faction: "neutral" });
    }
  });
};

exports.update = function(entity, ctx) {
  if (ctx.state.dead) return;
  if (ctx.state.hostile && ctx.state.aggroId) {
    var target = ctx.scene.findById(ctx.state.aggroId);
    if (!target) { ctx.state.hostile = false; return; }
    var dx = target.position[0] - entity.position[0];
    var dz = target.position[2] - entity.position[2];
    var dist = Math.sqrt(dx * dx + dz * dz) || 0.001;
    if (dist > ATTACK_RANGE) {
      ctx.scene.setPosition(entity.id, [
        entity.position[0] + (dx / dist) * MOVE_SPEED * 1.4 * ctx.time.delta,
        entity.position[1],
        entity.position[2] + (dz / dist) * MOVE_SPEED * 1.4 * ctx.time.delta
      ]);
    } else if (ctx.time.elapsed - ctx.state.lastAttack >= ATTACK_COOLDOWN) {
      ctx.state.lastAttack = ctx.time.elapsed;
      ctx.scene.send(target.id, "damage", { amount: ATTACK_DAMAGE });
    }
    return;
  }
  // Peaceful wander
  ctx.state.wanderT -= ctx.time.delta;
  if (ctx.state.wanderT <= 0) {
    ctx.state.wanderT = 2 + Math.random() * 3;
    ctx.state.wanderDir = [Math.random() - 0.5, Math.random() - 0.5];
  }
  var len = Math.sqrt(ctx.state.wanderDir[0] * ctx.state.wanderDir[0] + ctx.state.wanderDir[1] * ctx.state.wanderDir[1]) || 1;
  ctx.scene.setPosition(entity.id, [
    entity.position[0] + (ctx.state.wanderDir[0] / len) * MOVE_SPEED * ctx.time.delta,
    entity.position[1],
    entity.position[2] + (ctx.state.wanderDir[1] / len) * MOVE_SPEED * ctx.time.delta
  ]);
};
`;

const VENDOR = String.raw`
exports.start = function(entity, ctx) {
  ctx.state.faction = "vendor";
  ctx.state.role = "vendor";
  // Stock: parse npcLine as JSON array, or treat as shop title + default goods
  var stock = [
    { id: "potion", name: "Health Potion", price: 25 },
    { id: "ammo", name: "Ammo Pack", price: 15 },
    { id: "ration", name: "Ration", price: 10 }
  ];
  if (typeof entity.npcLine === "string" && entity.npcLine.trim().charAt(0) === "[") {
    try { stock = JSON.parse(entity.npcLine); } catch (e) { /* keep default */ }
  }
  ctx.state.stock = stock;
  ctx.state.title = (typeof entity.npcLine === "string" && entity.npcLine.trim().charAt(0) !== "[")
    ? entity.npcLine
    : (entity.name || "Vendor");

  ctx.events.on("interact", function(payload) {
    if (!payload || payload.targetId !== entity.id) return;
    ctx.events.emit("npcDialog", {
      fromId: entity.id,
      name: ctx.state.title,
      line: "Welcome, traveler. Browse my wares.",
    });
    ctx.events.emit("vendorOpen", {
      vendorId: entity.id,
      name: ctx.state.title,
      stock: ctx.state.stock,
    });
  });
};
`;

const BOSS = String.raw`
const BASE_HEALTH = 500;
const BASE_SPEED = 4.2;
const BASE_DAMAGE = 35;
const ATTACK_RANGE = 3.2;
const ATTACK_COOLDOWN = 0.85;
const ENRAGE_PCT = 0.3;

exports.start = function(entity, ctx) {
  ctx.state.maxHealth = BASE_HEALTH;
  ctx.state.health = BASE_HEALTH;
  ctx.state.dead = false;
  ctx.state.lastAttack = -999;
  ctx.state.enraged = false;
  ctx.state.faction = "enemy";
  ctx.state.role = "boss";
  ctx.state.spawnPos = entity.position.slice();
  ctx.scene.on("damage", function(payload, fromId) {
    if (ctx.state.dead) return;
    var dmg = (payload && typeof payload.amount === "number") ? payload.amount : 10;
    ctx.state.health = Math.max(0, ctx.state.health - dmg);
    ctx.events.emit("bossHealth", {
      bossId: entity.id,
      health: ctx.state.health,
      max: ctx.state.maxHealth,
      enraged: ctx.state.enraged,
    });
    if (ctx.state.health <= 0) {
      ctx.state.dead = true;
      ctx.scene.freeze(entity.id);
      ctx.events.emit("kill", { killerId: fromId, victimId: entity.id, victimIsPlayer: false, faction: "boss" });
      ctx.events.emit("bossDefeated", { bossId: entity.id });
    }
  });
  ctx.events.emit("bossHealth", { bossId: entity.id, health: BASE_HEALTH, max: BASE_HEALTH, enraged: false });
};

exports.update = function(entity, ctx) {
  if (ctx.state.dead) return;
  var player = ctx.scene.find("Player");
  if (!player) {
    var plist = ctx.scene.findAll(function(e) {
      return e.behavior === "player-deathmatch" || e.behavior === "player-rpg";
    });
    player = plist[0];
  }
  if (!player) return;

  var pct = ctx.state.health / ctx.state.maxHealth;
  if (!ctx.state.enraged && pct <= ENRAGE_PCT) {
    ctx.state.enraged = true;
    ctx.events.emit("bossEnrage", { bossId: entity.id });
  }
  var speed = ctx.state.enraged ? BASE_SPEED * 1.45 : BASE_SPEED;
  var damage = ctx.state.enraged ? BASE_DAMAGE * 1.5 : BASE_DAMAGE;

  var dx = player.position[0] - entity.position[0];
  var dz = player.position[2] - entity.position[2];
  var dist = Math.sqrt(dx * dx + dz * dz) || 0.001;
  if (dist > ATTACK_RANGE) {
    ctx.scene.setPosition(entity.id, [
      entity.position[0] + (dx / dist) * speed * ctx.time.delta,
      entity.position[1],
      entity.position[2] + (dz / dist) * speed * ctx.time.delta
    ]);
  } else if (ctx.time.elapsed - ctx.state.lastAttack >= ATTACK_COOLDOWN) {
    ctx.state.lastAttack = ctx.time.elapsed;
    ctx.scene.send(player.id, "damage", { amount: damage });
    ctx.events.emit("bossAttack", { bossId: entity.id, amount: damage, enraged: ctx.state.enraged });
  }
};
`;

// ──────────────────────────────────────────────────────────────────────────────
// RTS skirmish — selection, orders, economy, production, combat
// Used by the rts-fort-royale starter (Warcraft-style foundation).
// ──────────────────────────────────────────────────────────────────────────────

/** Shared helpers inlined into each RTS behavior string (no module imports
 *  inside String.raw behavior sources). Keep this small and pure JS. */
const RTS_SHARED_PREAMBLE = String.raw`
function distXZ(a, b) {
  var dx = a[0] - b[0], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dz * dz);
}
function moveToward(entity, target, speed, dt) {
  var dx = target[0] - entity.position[0];
  var dz = target[2] - entity.position[2];
  var d = Math.sqrt(dx * dx + dz * dz) || 1;
  if (d < 0.35) return d;
  var step = Math.min(speed * dt, d);
  entity.position = [
    entity.position[0] + (dx / d) * step,
    entity.position[1],
    entity.position[2] + (dz / d) * step,
  ];
  entity.rotation = [0, Math.atan2(dx, dz), 0];
  return d;
}
function isPlayerSide(entity) {
  return entity.layer === "Player" || (entity.name && entity.name.indexOf("Player") === 0);
}
function factionOf(entity) {
  return isPlayerSide(entity) ? "player" : "enemy";
}
function isRtsUnit(e) {
  if (!e) return false;
  var b = e.behavior || "";
  return b === "rts-peon" || b === "rts-footman" || b === "rts-archer" || b === "rts-creep";
}
function isRtsBuilding(e) {
  if (!e) return false;
  var b = e.behavior || "";
  if (b === "rts-building" || b === "rts-tower") return true;
  var n = e.name || "";
  return n.indexOf("TownHall") >= 0 || n.indexOf("Barracks") >= 0 ||
    n.indexOf("Farm") >= 0 || n.indexOf("Mill") >= 0 || n.indexOf("Tower") >= 0;
}
function isHostile(entity, other) {
  if (!other || other.id === entity.id) return false;
  if (other.behavior === "rts-creep") {
    // Creeps are hostile to both armies
    return isRtsUnit(entity) || isRtsBuilding(entity);
  }
  if (entity.behavior === "rts-creep") {
    return isRtsUnit(other) || isRtsBuilding(other);
  }
  var aPlayer = isPlayerSide(entity);
  var bPlayer = isPlayerSide(other);
  if (aPlayer === bPlayer) return false;
  return isRtsUnit(other) || isRtsBuilding(other);
}
function findHostile(entity, ctx, maxDist) {
  var best = null, bestD = maxDist || 80;
  var all = ctx.scene.findAll(function(e) { return e.id !== entity.id; });
  for (var i = 0; i < all.length; i++) {
    var o = all[i];
    if (!isHostile(entity, o)) continue;
    var d = distXZ(entity.position, o.position);
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}
function dealDamage(ctx, target, amount) {
  if (!target) return;
  ctx.scene.send(target.id, "damage", { amount: amount });
  if (isRtsBuilding(target)) {
    ctx.events.emit("rtsBuildingDamage", {
      buildingId: target.id,
      name: target.name,
      amount: amount,
      faction: factionOf(target),
    });
  }
}
function bindDamage(entity, ctx, onDeath) {
  ctx.scene.on("damage", function(payload) {
    if (ctx.state.dead) return;
    var dmg = (payload && typeof payload.amount === "number") ? payload.amount : 10;
    ctx.state.health = Math.max(0, (ctx.state.health || 0) - dmg);
    if (ctx.state.health <= 0) {
      ctx.state.dead = true;
      ctx.state.health = 0;
      entity.position = [entity.position[0], entity.position[1] - 80, entity.position[2]];
      if (onDeath) onDeath();
    }
  });
  ctx.scene.on("rtsOrder", function(payload) {
    if (ctx.state.dead || !payload) return;
    ctx.state.order = payload;
    ctx.state.selected = true;
  });
  ctx.scene.on("rtsSelect", function(payload) {
    ctx.state.selected = !!(payload && payload.selected);
  });
  ctx.scene.on("rtsStop", function() {
    ctx.state.order = { type: "stop" };
  });
}
function emitUnitHud(entity, ctx) {
  if (!ctx.state.selected) return;
  ctx.events.emit("rtsSelection", {
    id: entity.id,
    name: entity.name,
    kind: entity.behavior || "unit",
    health: ctx.state.health || 0,
    maxHealth: ctx.state.maxHealth || 1,
    faction: factionOf(entity),
    carrying: ctx.state.carrying || 0,
    carryKind: ctx.state.carryKind || null,
  });
}
`;

const RTS_PEON = RTS_SHARED_PREAMBLE + String.raw`
const MOVE_SPEED = 4.4;
const GATHER_RANGE = 3.4;
const DEPOSIT_RANGE = 6;
const GATHER_RATE = 9;
const CARRY_CAP = 20;

function findNearestResource(entity, ctx, preferWood) {
  var best = null, bestD = 1e9;
  var all = ctx.scene.findAll(function(e) {
    if (!e.name) return false;
    if (preferWood) return e.name.indexOf("Forest") === 0 || e.name.indexOf("Tree") === 0;
    return e.name.indexOf("GoldMine") === 0 || e.name.indexOf("Gold") === 0;
  });
  if (all.length === 0) {
    all = ctx.scene.findAll(function(e) {
      return e.name && (e.name.indexOf("GoldMine") === 0 || e.name.indexOf("Forest") === 0);
    });
  }
  for (var i = 0; i < all.length; i++) {
    var o = all[i];
    var d = distXZ(entity.position, o.position);
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}
function findOwnHall(entity, ctx) {
  var name = isPlayerSide(entity) ? "PlayerTownHall" : "EnemyTownHall";
  return ctx.scene.find(name);
}
function resourceKind(node) {
  if (!node || !node.name) return "gold";
  if (node.name.indexOf("Forest") === 0 || node.name.indexOf("Tree") === 0) return "wood";
  return "gold";
}

exports.start = function(entity, ctx) {
  ctx.state.carrying = 0;
  ctx.state.carryKind = "gold";
  ctx.state.phase = "idle";
  ctx.state.dead = false;
  ctx.state.health = 45;
  ctx.state.maxHealth = 45;
  ctx.state.selected = false;
  ctx.state.order = null;
  ctx.state.autoGather = true;
  bindDamage(entity, ctx, function() {
    ctx.events.emit("rtsUnitDied", { id: entity.id, faction: factionOf(entity), kind: "peon" });
  });
};

exports.update = function(entity, ctx) {
  if (ctx.state.dead) return;
  var dt = ctx.time.delta;
  var order = ctx.state.order;

  // Enemy peons always auto-gather; player peons auto until ordered.
  if (order && order.type === "move") {
    var dMove = moveToward(entity, [order.x, 0, order.z], MOVE_SPEED, dt);
    if (dMove < 0.5) ctx.state.order = null;
    emitUnitHud(entity, ctx);
    return;
  }
  if (order && order.type === "attack" && order.targetId) {
    var atk = ctx.scene.findById(order.targetId);
    if (atk && isHostile(entity, atk)) {
      var da = moveToward(entity, atk.position, MOVE_SPEED, dt);
      if (da < 2.0 && ctx.time.elapsed - (ctx.state.lastAttack || 0) > 1.1) {
        ctx.state.lastAttack = ctx.time.elapsed;
        dealDamage(ctx, atk, 4);
      }
      emitUnitHud(entity, ctx);
      return;
    }
    ctx.state.order = null;
  }
  if (order && order.type === "gather" && order.targetId) {
    var node = ctx.scene.findById(order.targetId);
    if (node) {
      ctx.state.resourceId = node.id;
      ctx.state.phase = "to_resource";
      ctx.state.order = null;
    }
  }
  if (order && order.type === "stop") {
    ctx.state.order = null;
    ctx.state.phase = "idle";
  }

  if (ctx.state.phase === "idle" && (ctx.state.autoGather || !isPlayerSide(entity))) {
    ctx.state.phase = "to_resource";
  }

  if (ctx.state.phase === "to_resource" || ctx.state.phase === "gather") {
    var mine = ctx.state.resourceId ? ctx.scene.findById(ctx.state.resourceId) : null;
    if (!mine) mine = findNearestResource(entity, ctx, false);
    if (!mine) { ctx.state.phase = "idle"; emitUnitHud(entity, ctx); return; }
    ctx.state.resourceId = mine.id;
    var d = moveToward(entity, mine.position, MOVE_SPEED, dt);
    if (d <= GATHER_RANGE) {
      ctx.state.phase = "gather";
      ctx.state.carryKind = resourceKind(mine);
      ctx.state.carrying = Math.min(CARRY_CAP, (ctx.state.carrying || 0) + GATHER_RATE * dt);
      if (ctx.state.carrying >= CARRY_CAP - 0.01) ctx.state.phase = "to_hall";
    } else {
      ctx.state.phase = "to_resource";
    }
  } else if (ctx.state.phase === "to_hall") {
    var hall = findOwnHall(entity, ctx);
    if (!hall) { ctx.state.phase = "to_resource"; return; }
    var d2 = moveToward(entity, hall.position, MOVE_SPEED, dt);
    if (d2 <= DEPOSIT_RANGE) {
      var amt = Math.floor(ctx.state.carrying || 0);
      if (amt > 0) {
        ctx.events.emit("rtsResource", {
          faction: factionOf(entity),
          kind: ctx.state.carryKind || "gold",
          amount: amt,
          fromId: entity.id,
        });
      }
      ctx.state.carrying = 0;
      ctx.state.phase = "to_resource";
    }
  }
  emitUnitHud(entity, ctx);
};
`;

const RTS_FOOTMAN = RTS_SHARED_PREAMBLE + String.raw`
exports.start = function(entity, ctx) {
  var player = isPlayerSide(entity);
  ctx.state.health = 100;
  ctx.state.maxHealth = 100;
  ctx.state.dead = false;
  ctx.state.lastAttack = -999;
  ctx.state.dmg = player ? 14 : 13;
  ctx.state.range = 2.3;
  ctx.state.speed = player ? 4.6 : 4.4;
  ctx.state.selected = false;
  ctx.state.order = null;
  ctx.state.autoEngage = true;
  bindDamage(entity, ctx, function() {
    ctx.events.emit("rtsUnitDied", { id: entity.id, faction: factionOf(entity), kind: "footman" });
  });
};

exports.update = function(entity, ctx) {
  if (ctx.state.dead) return;
  var dt = ctx.time.delta;
  var order = ctx.state.order;
  var target = null;

  if (order && order.type === "move") {
    var dMove = moveToward(entity, [order.x, 0, order.z], ctx.state.speed, dt);
    if (dMove < 0.5) ctx.state.order = null;
    // opportunistic engage while moving
    var near = findHostile(entity, ctx, 8);
    if (near) target = near;
    else { emitUnitHud(entity, ctx); return; }
  } else if (order && order.type === "attack" && order.targetId) {
    target = ctx.scene.findById(order.targetId);
    if (!target) ctx.state.order = null;
  } else if (order && order.type === "attack-move") {
    target = findHostile(entity, ctx, 22) || null;
    if (!target) {
      moveToward(entity, [order.x, 0, order.z], ctx.state.speed, dt);
      emitUnitHud(entity, ctx);
      return;
    }
  } else if (order && order.type === "stop") {
    ctx.state.order = null;
  }

  if (!target && ctx.state.autoEngage) {
    target = findHostile(entity, ctx, isPlayerSide(entity) ? 28 : 55);
  }
  if (!target) { emitUnitHud(entity, ctx); return; }

  var dx = target.position[0] - entity.position[0];
  var dz = target.position[2] - entity.position[2];
  var d = Math.sqrt(dx * dx + dz * dz) || 1;
  entity.rotation = [0, Math.atan2(dx, dz), 0];
  if (d > ctx.state.range) {
    var step = Math.min(ctx.state.speed * dt, d - ctx.state.range + 0.1);
    entity.position = [
      entity.position[0] + (dx / d) * step,
      entity.position[1],
      entity.position[2] + (dz / d) * step,
    ];
  } else if (ctx.time.elapsed - ctx.state.lastAttack >= 0.7) {
    ctx.state.lastAttack = ctx.time.elapsed;
    dealDamage(ctx, target, ctx.state.dmg);
  }
  emitUnitHud(entity, ctx);
};
`;

const RTS_ARCHER = RTS_SHARED_PREAMBLE + String.raw`
exports.start = function(entity, ctx) {
  var player = isPlayerSide(entity);
  ctx.state.health = 70;
  ctx.state.maxHealth = 70;
  ctx.state.dead = false;
  ctx.state.lastAttack = -999;
  ctx.state.dmg = player ? 11 : 10;
  ctx.state.range = 12;
  ctx.state.speed = player ? 4.2 : 4.0;
  ctx.state.selected = false;
  ctx.state.order = null;
  ctx.state.autoEngage = true;
  bindDamage(entity, ctx, function() {
    ctx.events.emit("rtsUnitDied", { id: entity.id, faction: factionOf(entity), kind: "archer" });
  });
};

exports.update = function(entity, ctx) {
  if (ctx.state.dead) return;
  var dt = ctx.time.delta;
  var order = ctx.state.order;
  var target = null;

  if (order && order.type === "move") {
    var dMove = moveToward(entity, [order.x, 0, order.z], ctx.state.speed, dt);
    if (dMove < 0.5) ctx.state.order = null;
    emitUnitHud(entity, ctx);
    return;
  }
  if (order && order.type === "attack" && order.targetId) {
    target = ctx.scene.findById(order.targetId);
    if (!target) ctx.state.order = null;
  } else if (order && order.type === "stop") {
    ctx.state.order = null;
  }
  if (!target && ctx.state.autoEngage) {
    target = findHostile(entity, ctx, isPlayerSide(entity) ? 30 : 50);
  }
  if (!target) { emitUnitHud(entity, ctx); return; }

  var dx = target.position[0] - entity.position[0];
  var dz = target.position[2] - entity.position[2];
  var d = Math.sqrt(dx * dx + dz * dz) || 1;
  entity.rotation = [0, Math.atan2(dx, dz), 0];
  if (d > ctx.state.range) {
    var step = Math.min(ctx.state.speed * dt, d - ctx.state.range + 0.2);
    entity.position = [
      entity.position[0] + (dx / d) * step,
      entity.position[1],
      entity.position[2] + (dz / d) * step,
    ];
  } else if (d < 5) {
    // Keep preferred range — step back slightly
    entity.position = [
      entity.position[0] - (dx / d) * 2.5 * dt,
      entity.position[1],
      entity.position[2] - (dz / d) * 2.5 * dt,
    ];
  }
  if (d <= ctx.state.range && ctx.time.elapsed - ctx.state.lastAttack >= 0.95) {
    ctx.state.lastAttack = ctx.time.elapsed;
    dealDamage(ctx, target, ctx.state.dmg);
  }
  emitUnitHud(entity, ctx);
};
`;

const RTS_CREEP = RTS_SHARED_PREAMBLE + String.raw`
exports.start = function(entity, ctx) {
  ctx.state.home = entity.position.slice();
  ctx.state.health = 90;
  ctx.state.maxHealth = 90;
  ctx.state.dead = false;
  ctx.state.lastAttack = -999;
  ctx.state.aggro = false;
  bindDamage(entity, ctx, function() {
    ctx.events.emit("rtsUnitDied", { id: entity.id, faction: "neutral", kind: "creep" });
    // Bounty for whoever is nearby (player bias)
    ctx.events.emit("rtsResource", { faction: "player", kind: "gold", amount: 15, fromId: entity.id });
  });
};

exports.update = function(entity, ctx) {
  if (ctx.state.dead) return;
  var dt = ctx.time.delta;
  var units = ctx.scene.findAll(function(e) {
    return e.behavior === "rts-peon" || e.behavior === "rts-footman" || e.behavior === "rts-archer";
  });
  var nearest = null, bestD = 16;
  for (var i = 0; i < units.length; i++) {
    var d = distXZ(entity.position, units[i].position);
    if (d < bestD) { bestD = d; nearest = units[i]; }
  }
  if (nearest) ctx.state.aggro = true;
  if (!ctx.state.aggro || !nearest) {
    var hx = ctx.state.home[0] - entity.position[0];
    var hz = ctx.state.home[2] - entity.position[2];
    var hd = Math.sqrt(hx * hx + hz * hz);
    if (hd > 1.5) {
      entity.position = [
        entity.position[0] + (hx / hd) * 1.6 * dt,
        entity.position[1],
        entity.position[2] + (hz / hd) * 1.6 * dt,
      ];
    }
    return;
  }
  var dx = nearest.position[0] - entity.position[0];
  var dz = nearest.position[2] - entity.position[2];
  var d2 = Math.sqrt(dx * dx + dz * dz) || 1;
  entity.rotation = [0, Math.atan2(dx, dz), 0];
  if (d2 > 1.9) {
    entity.position = [
      entity.position[0] + (dx / d2) * 3.7 * dt,
      entity.position[1],
      entity.position[2] + (dz / d2) * 3.7 * dt,
    ];
  } else if (ctx.time.elapsed - ctx.state.lastAttack >= 0.85) {
    ctx.state.lastAttack = ctx.time.elapsed;
    ctx.scene.send(nearest.id, "damage", { amount: 15 });
  }
};
`;

const RTS_BUILDING = RTS_SHARED_PREAMBLE + String.raw`
function buildingMaxHp(name) {
  if (name.indexOf("TownHall") >= 0) return 1800;
  if (name.indexOf("Barracks") >= 0) return 900;
  if (name.indexOf("Farm") >= 0) return 500;
  if (name.indexOf("Mill") >= 0) return 700;
  return 800;
}
function buildingTrainOptions(name) {
  if (name.indexOf("TownHall") >= 0) return [
    { id: "peon", label: "Worker", gold: 50, wood: 0, food: 1, time: 4, behavior: "rts-peon", racePlayer: "dwarf", raceEnemy: "orc" }
  ];
  if (name.indexOf("Barracks") >= 0) return [
    { id: "footman", label: "Footman", gold: 75, wood: 0, food: 2, time: 5, behavior: "rts-footman", racePlayer: "warrior", raceEnemy: "orc" },
    { id: "archer", label: "Archer", gold: 60, wood: 25, food: 2, time: 5.5, behavior: "rts-archer", racePlayer: "elf", raceEnemy: "skeleton" }
  ];
  return [];
}

exports.start = function(entity, ctx) {
  ctx.state.health = buildingMaxHp(entity.name || "");
  ctx.state.maxHealth = ctx.state.health;
  ctx.state.dead = false;
  ctx.state.selected = false;
  ctx.state.queue = [];
  ctx.state.trainLeft = 0;
  ctx.state.trainSpec = null;
  ctx.state.rally = [
    entity.position[0] + (isPlayerSide(entity) ? 6 : -6),
    entity.position[1],
    entity.position[2] + (isPlayerSide(entity) ? 6 : -6),
  ];
  bindDamage(entity, ctx, function() {
    ctx.events.emit("rtsBuildingDestroyed", {
      id: entity.id,
      name: entity.name,
      faction: factionOf(entity),
    });
  });
  ctx.scene.on("rtsTrain", function(payload) {
    if (!ctx.state.selected || ctx.state.dead || !payload) return;
    var opts = buildingTrainOptions(entity.name || "");
    var spec = null;
    for (var i = 0; i < opts.length; i++) {
      if (opts[i].id === payload.unitId) { spec = opts[i]; break; }
    }
    if (!spec) return;
    ctx.events.emit("rtsTrainRequest", {
      buildingId: entity.id,
      buildingName: entity.name,
      faction: factionOf(entity),
      spec: spec,
    });
  });
  ctx.scene.on("rtsBeginTrain", function(payload) {
    if (!payload || payload.buildingId !== entity.id || ctx.state.dead) return;
    ctx.state.trainSpec = payload.spec;
    ctx.state.trainLeft = payload.spec.time || 4;
  });
  ctx.scene.on("rtsSetRally", function(payload) {
    if (!ctx.state.selected || !payload) return;
    ctx.state.rally = [payload.x, 0, payload.z];
  });
};

exports.update = function(entity, ctx) {
  if (ctx.state.dead) return;
  var dt = ctx.time.delta;
  if (ctx.state.trainSpec && ctx.state.trainLeft > 0) {
    ctx.state.trainLeft -= dt;
    if (ctx.state.trainLeft <= 0) {
      var spec = ctx.state.trainSpec;
      ctx.state.trainSpec = null;
      ctx.state.trainLeft = 0;
      var player = isPlayerSide(entity);
      var race = player ? spec.racePlayer : spec.raceEnemy;
      var tint = player ? undefined : "#ff6060";
      var spawnName = (player ? "Player" : "Enemy") + (spec.id === "peon" ? "Peon" : spec.id === "archer" ? "Archer" : "Footman") + "_" + Math.floor(ctx.time.elapsed);
      var id = ctx.scene.spawn({
        name: spawnName,
        position: [ctx.state.rally[0], 0, ctx.state.rally[2]],
        scale: [0.95, 0.95, 0.95],
        modelUrl: "builtin:race:" + race,
        raceId: race,
        layer: player ? "Player" : "NPC",
        behavior: spec.behavior,
        tint: tint,
      });
      if (id) {
        ctx.events.emit("rtsUnitTrained", {
          id: id,
          kind: spec.id,
          faction: player ? "player" : "enemy",
          food: spec.food || 1,
        });
      }
    }
  }
  if (ctx.state.selected) {
    ctx.events.emit("rtsSelection", {
      id: entity.id,
      name: entity.name,
      kind: "building",
      health: ctx.state.health,
      maxHealth: ctx.state.maxHealth,
      faction: factionOf(entity),
      trainOptions: buildingTrainOptions(entity.name || ""),
      training: ctx.state.trainSpec ? {
        unitId: ctx.state.trainSpec.id,
        label: ctx.state.trainSpec.label,
        left: Math.max(0, ctx.state.trainLeft),
        total: ctx.state.trainSpec.time || 4,
      } : null,
    });
  }
};
`;

const RTS_TOWER = RTS_SHARED_PREAMBLE + String.raw`
exports.start = function(entity, ctx) {
  ctx.state.health = 650;
  ctx.state.maxHealth = 650;
  ctx.state.dead = false;
  ctx.state.lastAttack = -999;
  ctx.state.dmg = 16;
  ctx.state.range = 16;
  ctx.state.selected = false;
  bindDamage(entity, ctx, function() {
    ctx.events.emit("rtsBuildingDestroyed", {
      id: entity.id,
      name: entity.name,
      faction: factionOf(entity),
    });
  });
};

exports.update = function(entity, ctx) {
  if (ctx.state.dead) return;
  var target = findHostile(entity, ctx, ctx.state.range);
  if (!target) {
    if (ctx.state.selected) {
      ctx.events.emit("rtsSelection", {
        id: entity.id, name: entity.name, kind: "tower",
        health: ctx.state.health, maxHealth: ctx.state.maxHealth,
        faction: factionOf(entity),
      });
    }
    return;
  }
  var dx = target.position[0] - entity.position[0];
  var dz = target.position[2] - entity.position[2];
  entity.rotation = [0, Math.atan2(dx, dz), 0];
  if (ctx.time.elapsed - ctx.state.lastAttack >= 1.05) {
    ctx.state.lastAttack = ctx.time.elapsed;
    dealDamage(ctx, target, ctx.state.dmg);
  }
  if (ctx.state.selected) {
    ctx.events.emit("rtsSelection", {
      id: entity.id, name: entity.name, kind: "tower",
      health: ctx.state.health, maxHealth: ctx.state.maxHealth,
      faction: factionOf(entity),
    });
  }
};
`;

const GAMEMODE_RTS = String.raw`
var UNIT_FOOD = { peon: 1, footman: 2, archer: 2 };

function countFood(ctx, faction) {
  var layer = faction === "player" ? "Player" : "NPC";
  var used = 0;
  var units = ctx.scene.findAll(function(e) {
    return e.layer === layer && (
      e.behavior === "rts-peon" || e.behavior === "rts-footman" || e.behavior === "rts-archer"
    );
  });
  for (var i = 0; i < units.length; i++) {
    var b = units[i].behavior;
    if (b === "rts-peon") used += 1;
    else used += 2;
  }
  return used;
}
function countFarms(ctx, faction) {
  var prefix = faction === "player" ? "Player" : "Enemy";
  var farms = ctx.scene.findAll(function(e) {
    return e.name && e.name.indexOf(prefix + "Farm") === 0;
  });
  return 5 + farms.length * 4; // hall provides 5, each farm +4
}
function emitHud(ctx) {
  ctx.events.emit("rtsHud", {
    playerGold: ctx.state.playerGold,
    playerWood: ctx.state.playerWood,
    playerFood: countFood(ctx, "player"),
    playerFoodMax: countFarms(ctx, "player"),
    enemyGold: ctx.state.enemyGold,
    enemyWood: ctx.state.enemyWood,
    enemyFood: countFood(ctx, "enemy"),
    enemyFoodMax: countFarms(ctx, "enemy"),
    playerHallHp: ctx.state.playerHallHp,
    enemyHallHp: ctx.state.enemyHallHp,
    playerHallMax: ctx.state.playerHallMax,
    enemyHallMax: ctx.state.enemyHallMax,
    selectedId: ctx.state.selectedId || null,
    selectedIds: ctx.state.selectedIds || [],
    message: ctx.state.message || null,
  });
}
function clearSelection(ctx) {
  var prev = ctx.state.selectedIds || [];
  for (var i = 0; i < prev.length; i++) {
    ctx.scene.send(prev[i], "rtsSelect", { selected: false });
  }
  ctx.state.selectedIds = [];
  ctx.state.selectedId = null;
  ctx.events.emit("rtsSelection", null);
}
function selectEntity(ctx, id, additive) {
  if (!additive) clearSelection(ctx);
  var e = ctx.scene.findById(id);
  if (!e) return;
  if (!isPlayerSide(e) && e.behavior !== "rts-creep") {
    // Allow inspecting enemy buildings briefly
  }
  if (!ctx.state.selectedIds) ctx.state.selectedIds = [];
  if (ctx.state.selectedIds.indexOf(id) < 0) ctx.state.selectedIds.push(id);
  ctx.state.selectedId = id;
  ctx.scene.send(id, "rtsSelect", { selected: true });
}
function isPlayerSide(entity) {
  return entity.layer === "Player" || (entity.name && entity.name.indexOf("Player") === 0);
}
function isSelectablePlayer(e) {
  if (!e || !isPlayerSide(e)) return false;
  var b = e.behavior || "";
  return b === "rts-peon" || b === "rts-footman" || b === "rts-archer" ||
    b === "rts-building" || b === "rts-tower";
}
function isOrderablePlayer(e) {
  if (!e || !isPlayerSide(e)) return false;
  var b = e.behavior || "";
  return b === "rts-peon" || b === "rts-footman" || b === "rts-archer";
}

exports.start = function(entity, ctx) {
  ctx.state.playerGold = 250;
  ctx.state.playerWood = 100;
  ctx.state.enemyGold = 250;
  ctx.state.enemyWood = 100;
  ctx.state.playerHallHp = 1800;
  ctx.state.enemyHallHp = 1800;
  ctx.state.playerHallMax = 1800;
  ctx.state.enemyHallMax = 1800;
  ctx.state.ended = false;
  ctx.state.selectedIds = [];
  ctx.state.selectedId = null;
  ctx.state.leftWasDown = false;
  ctx.state.rightWasDown = false;
  ctx.state.message = "Select units · Right-click to move / attack / gather";
  ctx.state.enemyAiTimer = 8;
  ctx.state.enemyWave = 0;
  emitHud(ctx);

  ctx.events.on("rtsResource", function(payload) {
    if (ctx.state.ended || !payload) return;
    var kind = payload.kind || "gold";
    var amt = payload.amount || 0;
    if (payload.faction === "player") {
      if (kind === "wood") ctx.state.playerWood += amt;
      else ctx.state.playerGold += amt;
    } else if (payload.faction === "enemy") {
      if (kind === "wood") ctx.state.enemyWood += amt;
      else ctx.state.enemyGold += amt;
    }
    emitHud(ctx);
  });
  // Back-compat for older peon scripts
  ctx.events.on("rtsGold", function(payload) {
    if (ctx.state.ended || !payload) return;
    if (payload.faction === "player") ctx.state.playerGold += payload.amount || 0;
    else if (payload.faction === "enemy") ctx.state.enemyGold += payload.amount || 0;
    emitHud(ctx);
  });
  ctx.events.on("rtsBuildingDamage", function(payload) {
    if (ctx.state.ended || !payload) return;
    var name = payload.name || "";
    var amt = payload.amount || 0;
    if (name.indexOf("PlayerTownHall") >= 0) {
      ctx.state.playerHallHp = Math.max(0, ctx.state.playerHallHp - amt);
    }
    if (name.indexOf("EnemyTownHall") >= 0) {
      ctx.state.enemyHallHp = Math.max(0, ctx.state.enemyHallHp - amt);
    }
    emitHud(ctx);
    if (ctx.state.playerHallHp <= 0) {
      ctx.state.ended = true;
      ctx.events.emit("lose", { reason: "townhall" });
      ctx.events.emit("outcome", { result: "lose" });
    } else if (ctx.state.enemyHallHp <= 0) {
      ctx.state.ended = true;
      ctx.events.emit("win", { reason: "townhall" });
      ctx.events.emit("outcome", { result: "win" });
    }
  });
  ctx.events.on("rtsBuildingDestroyed", function(payload) {
    if (ctx.state.ended || !payload) return;
    if (payload.name && payload.name.indexOf("TownHall") >= 0) {
      if (payload.faction === "player") {
        ctx.state.playerHallHp = 0;
        ctx.state.ended = true;
        ctx.events.emit("lose", { reason: "townhall" });
        ctx.events.emit("outcome", { result: "lose" });
      } else if (payload.faction === "enemy") {
        ctx.state.enemyHallHp = 0;
        ctx.state.ended = true;
        ctx.events.emit("win", { reason: "townhall" });
        ctx.events.emit("outcome", { result: "win" });
      }
    }
    emitHud(ctx);
  });
  ctx.events.on("rtsTrainRequest", function(payload) {
    if (ctx.state.ended || !payload || !payload.spec) return;
    var faction = payload.faction || "player";
    var spec = payload.spec;
    var gold = faction === "player" ? ctx.state.playerGold : ctx.state.enemyGold;
    var wood = faction === "player" ? ctx.state.playerWood : ctx.state.enemyWood;
    var food = countFood(ctx, faction);
    var foodMax = countFarms(ctx, faction);
    if (gold < (spec.gold || 0) || wood < (spec.wood || 0)) {
      if (faction === "player") {
        ctx.state.message = "Not enough resources";
        emitHud(ctx);
      }
      return;
    }
    if (food + (spec.food || 1) > foodMax) {
      if (faction === "player") {
        ctx.state.message = "Need more farms (food cap)";
        emitHud(ctx);
      }
      return;
    }
    if (faction === "player") {
      ctx.state.playerGold -= spec.gold || 0;
      ctx.state.playerWood -= spec.wood || 0;
    } else {
      ctx.state.enemyGold -= spec.gold || 0;
      ctx.state.enemyWood -= spec.wood || 0;
    }
    ctx.scene.send(payload.buildingId, "rtsBeginTrain", { buildingId: payload.buildingId, spec: spec });
    if (faction === "player") ctx.state.message = "Training " + (spec.label || "unit") + "…";
    emitHud(ctx);
  });
  ctx.events.on("rtsHudCommand", function(payload) {
    if (ctx.state.ended || !payload) return;
    if (payload.action === "train" && payload.unitId && ctx.state.selectedId) {
      ctx.scene.send(ctx.state.selectedId, "rtsTrain", { unitId: payload.unitId });
    }
    if (payload.action === "stop" && ctx.state.selectedIds) {
      for (var i = 0; i < ctx.state.selectedIds.length; i++) {
        ctx.scene.send(ctx.state.selectedIds[i], "rtsStop", {});
      }
    }
  });
};

exports.update = function(entity, ctx) {
  if (ctx.state.ended) return;
  var mouse = ctx.input.mouse;
  var left = !!mouse.left;
  var right = !!mouse.right;
  var leftClick = left && !ctx.state.leftWasDown;
  var rightClick = right && !ctx.state.rightWasDown;
  ctx.state.leftWasDown = left;
  ctx.state.rightWasDown = right;

  // Hotkeys: 1 = select all military, 2 = select workers, A = attack-move mode flag
  if (ctx.input.keys["1"] && !ctx.state.key1) {
    clearSelection(ctx);
    var mil = ctx.scene.findAll(function(e) {
      return isPlayerSide(e) && (e.behavior === "rts-footman" || e.behavior === "rts-archer");
    });
    for (var m = 0; m < mil.length; m++) selectEntity(ctx, mil[m].id, true);
    ctx.state.message = "Selected military (" + mil.length + ")";
    emitHud(ctx);
  }
  ctx.state.key1 = !!ctx.input.keys["1"];
  if (ctx.input.keys["2"] && !ctx.state.key2) {
    clearSelection(ctx);
    var wrk = ctx.scene.findAll(function(e) {
      return isPlayerSide(e) && e.behavior === "rts-peon";
    });
    for (var w = 0; w < wrk.length; w++) selectEntity(ctx, wrk[w].id, true);
    ctx.state.message = "Selected workers (" + wrk.length + ")";
    emitHud(ctx);
  }
  ctx.state.key2 = !!ctx.input.keys["2"];

  if (leftClick) {
    var hit = ctx.scene.castScreenRay(600);
    if (hit && hit.entityId) {
      var picked = ctx.scene.findById(hit.entityId);
      if (picked && isSelectablePlayer(picked)) {
        selectEntity(ctx, picked.id, !!(ctx.input.keys["Shift"] || ctx.input.keys["ShiftLeft"]));
        ctx.state.message = "Selected " + (picked.name || "unit");
        emitHud(ctx);
      } else if (picked && (picked.behavior === "rts-building" || picked.behavior === "rts-tower")) {
        selectEntity(ctx, picked.id, false);
        emitHud(ctx);
      } else {
        clearSelection(ctx);
        emitHud(ctx);
      }
    } else {
      clearSelection(ctx);
      emitHud(ctx);
    }
  }

  if (rightClick && ctx.state.selectedIds && ctx.state.selectedIds.length > 0) {
    var hitR = ctx.scene.castScreenRay(600);
    if (hitR) {
      var target = hitR.entityId ? ctx.scene.findById(hitR.entityId) : null;
      var order = null;
      if (target && target.behavior === "rts-creep") {
        order = { type: "attack", targetId: target.id };
        ctx.state.message = "Attack creep";
      } else if (target && !isPlayerSide(target) && (target.behavior === "rts-peon" || target.behavior === "rts-footman" || target.behavior === "rts-archer" || target.behavior === "rts-building" || target.behavior === "rts-tower" || (target.name && target.name.indexOf("Enemy") === 0))) {
        order = { type: "attack", targetId: target.id };
        ctx.state.message = "Attack " + (target.name || "enemy");
      } else if (target && (target.name && (target.name.indexOf("GoldMine") === 0 || target.name.indexOf("Forest") === 0 || target.name.indexOf("Tree") === 0))) {
        order = { type: "gather", targetId: target.id };
        ctx.state.message = "Gather resources";
      } else {
        order = { type: "move", x: hitR.point[0], z: hitR.point[2] };
        ctx.state.message = "Moving";
      }
      // Rally point for buildings
      for (var s = 0; s < ctx.state.selectedIds.length; s++) {
        var sel = ctx.scene.findById(ctx.state.selectedIds[s]);
        if (!sel) continue;
        if (sel.behavior === "rts-building" || sel.behavior === "rts-tower") {
          ctx.scene.send(sel.id, "rtsSetRally", { x: hitR.point[0], z: hitR.point[2] });
        } else if (isOrderablePlayer(sel)) {
          ctx.scene.send(sel.id, "rtsOrder", order);
        }
      }
      emitHud(ctx);
    }
  }

  // Enemy AI — train + periodic attack-move toward player hall
  ctx.state.enemyAiTimer -= ctx.time.delta;
  if (ctx.state.enemyAiTimer <= 0) {
    ctx.state.enemyAiTimer = 10 + Math.random() * 4;
    ctx.state.enemyWave = (ctx.state.enemyWave || 0) + 1;
    var barracks = ctx.scene.find("EnemyBarracks");
    var hall = ctx.scene.find("EnemyTownHall");
    var trainBuilding = barracks || hall;
    if (trainBuilding && ctx.state.enemyGold >= 75) {
      var unitId = ctx.state.enemyWave % 3 === 0 ? "archer" : (ctx.state.enemyWave % 2 === 0 ? "footman" : "peon");
      if (unitId === "peon" && hall) {
        ctx.events.emit("rtsTrainRequest", {
          buildingId: hall.id,
          buildingName: hall.name,
          faction: "enemy",
          spec: { id: "peon", label: "Worker", gold: 50, wood: 0, food: 1, time: 4, behavior: "rts-peon", racePlayer: "dwarf", raceEnemy: "orc" },
        });
      } else if (barracks) {
        var spec = unitId === "archer"
          ? { id: "archer", label: "Archer", gold: 60, wood: 25, food: 2, time: 5.5, behavior: "rts-archer", racePlayer: "elf", raceEnemy: "skeleton" }
          : { id: "footman", label: "Footman", gold: 75, wood: 0, food: 2, time: 5, behavior: "rts-footman", racePlayer: "warrior", raceEnemy: "orc" };
        ctx.events.emit("rtsTrainRequest", {
          buildingId: barracks.id,
          buildingName: barracks.name,
          faction: "enemy",
          spec: spec,
        });
      }
    }
    // Push military toward player town hall every other wave
    if (ctx.state.enemyWave % 2 === 0) {
      var pHall = ctx.scene.find("PlayerTownHall");
      if (pHall) {
        var army = ctx.scene.findAll(function(e) {
          return e.layer === "NPC" && (e.behavior === "rts-footman" || e.behavior === "rts-archer");
        });
        for (var a = 0; a < army.length; a++) {
          ctx.scene.send(army[a].id, "rtsOrder", {
            type: "attack-move",
            x: pHall.position[0],
            z: pHall.position[2],
            targetId: pHall.id,
          });
        }
      }
    }
  }

  if (!ctx.state._lastHud || ctx.time.elapsed - ctx.state._lastHud > 1.0) {
    ctx.state._lastHud = ctx.time.elapsed;
    emitHud(ctx);
  }
};
`;

export const BUILTIN_BEHAVIORS: Record<BehaviorKind, string> = {
  "player-deathmatch": PLAYER_DEATHMATCH,
  "enemy-deathmatch": ENEMY_DEATHMATCH,
  "gamemode-deathmatch": GAMEMODE_DEATHMATCH,
  spawnpoint: "// marker — no behavior",
  "pickup-trigger": PICKUP_TRIGGER,
  "player-rpg": PLAYER_RPG,
  "enemy-rpg": ENEMY_RPG,
  "npc-dialog": NPC_DIALOG,
  ally: ALLY_COMBAT,
  neutral: NEUTRAL_WANDER,
  vendor: VENDOR,
  boss: BOSS,
  "rts-peon": RTS_PEON,
  "rts-footman": RTS_FOOTMAN,
  "rts-archer": RTS_ARCHER,
  "rts-creep": RTS_CREEP,
  "rts-building": RTS_BUILDING,
  "rts-tower": RTS_TOWER,
  "gamemode-rts": GAMEMODE_RTS,
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
  ally: "NPC",
  neutral: "NPC",
  vendor: "NPC",
  boss: "NPC",
  "rts-peon": null,
  "rts-footman": null,
  "rts-archer": null,
  "rts-creep": "NPC",
  "rts-building": null,
  "rts-tower": null,
  "gamemode-rts": null,
};

/** High-level faction / ruleset catalog for AI + designers. */
export const FACTION_RULESETS = {
  deathmatch: {
    id: "deathmatch",
    description: "Player vs all enemy-deathmatch/boss. First to scoreLimit wins.",
    player: ["player-deathmatch"],
    hostile: ["enemy-deathmatch", "boss"],
    friendly: ["ally"],
    civilian: ["neutral", "vendor", "npc-dialog"],
  },
  rpg: {
    id: "rpg",
    description: "Adventure rules: permanent death, interact vendors, aggro RPG enemies.",
    player: ["player-rpg"],
    hostile: ["enemy-rpg", "boss"],
    friendly: ["ally", "npc-dialog", "vendor"],
    civilian: ["neutral"],
  },
  skirmish: {
    id: "skirmish",
    description: "Mixed forces: allies help player, neutrals ignore until struck, boss is objective.",
    player: ["player-deathmatch", "player-rpg"],
    hostile: ["enemy-deathmatch", "enemy-rpg", "boss"],
    friendly: ["ally"],
    civilian: ["neutral", "vendor", "npc-dialog"],
  },
  rts: {
    id: "rts",
    description:
      "Toon RTS / Wargus: GameManager gamemode-rts, workers, military, buildings, creeps. Economy gold/wood/food.",
    player: ["rts-peon", "rts-footman", "rts-archer", "rts-building", "rts-tower"],
    hostile: ["rts-creep"],
    friendly: [],
    civilian: [],
  },
} as const;
