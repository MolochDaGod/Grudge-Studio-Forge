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
 *   • `enemy-deathmatch` — Yuka SteeringEntity with SeekBehavior pursuing the
 *     player. Periodic ranged shot at the player when within 18 m. Health,
 *     death + respawn after `respawnDelay` at a random spawn point, then
 *     re-enables steering.
 *
 *   • `gamemode-deathmatch` — attached to a hidden empty named "GameManager".
 *     Listens to `kill` events from the game bus, tracks player vs. enemy
 *     score, and emits `win`/`lose` when either side reaches `scoreLimit`.
 *
 *   • `spawnpoint` — pure marker behavior; no logic. Lets the other scripts
 *     find spawn points by `behavior === "spawnpoint"`.
 */

import type { BehaviorKind } from "@/scene/types";

// ──────────────────────────────────────────────────────────────────────────────
// Player
// ──────────────────────────────────────────────────────────────────────────────

const PLAYER_DEATHMATCH = String.raw`
const FIRE_COOLDOWN = 0.18;   // seconds between shots
const SHOT_RANGE = 80;
const SHOT_DAMAGE = 25;
const MAX_HEALTH = 100;

exports.start = function(entity, ctx) {
  ctx.state.health = MAX_HEALTH;
  ctx.state.lastShot = -999;
  ctx.state.dead = false;
  ctx.state.deadUntil = 0;
  ctx.state.score = 0;
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

  // LMB shoot with cooldown.
  if (ctx.input.mouse.left && ctx.time.elapsed - ctx.state.lastShot >= FIRE_COOLDOWN) {
    ctx.state.lastShot = ctx.time.elapsed;
    const origin = ctx.scene.cameraPosition();
    const dir = ctx.scene.cameraDirection();
    const hit = ctx.scene.castRay(origin, dir, SHOT_RANGE, [entity.id]);
    ctx.events.emit("playerShot", { origin: origin, dir: dir, hit: hit });
    if (hit && hit.entityId) {
      ctx.scene.send(hit.entityId, "damage", { amount: SHOT_DAMAGE, fromId: entity.id });
      ctx.events.emit("hit", { entityId: hit.entityId, point: hit.point });
    }
  }
};
`;

// ──────────────────────────────────────────────────────────────────────────────
// Enemy
// ──────────────────────────────────────────────────────────────────────────────

const ENEMY_DEATHMATCH = String.raw`
const MAX_HEALTH = 60;
const SEEK_MAX_SPEED = 4.0;            // m/s
const ATTACK_RANGE = 18;
const ATTACK_COOLDOWN = 1.2;           // seconds
const ATTACK_DAMAGE = 10;
const STOP_DISTANCE = 2.5;             // don't push into the player

exports.start = function(entity, ctx) {
  ctx.state.health = MAX_HEALTH;
  ctx.state.dead = false;
  ctx.state.deadUntil = 0;
  ctx.state.lastAttack = -999;
  ctx.state.spawnPos = entity.position.slice();

  // Yuka steering vehicle. We treat the entity's position as world-space and
  // step the steering manager once per frame, then write the resulting
  // velocity-scaled position back to the body.
  const yk = ctx.yuka;
  const v = new yk.Vehicle();
  v.position.set(entity.position[0], entity.position[1], entity.position[2]);
  v.maxSpeed = SEEK_MAX_SPEED;
  // Empty target — updated each frame in update().
  ctx.state.seek = new yk.SeekBehavior(new yk.Vector3(0, 0, 0));
  v.steering.add(ctx.state.seek);
  ctx.state.vehicle = v;
  ctx.state.entityManager = new yk.EntityManager();
  ctx.state.entityManager.add(v);

  ctx.scene.on("damage", function(payload, fromId) {
    if (ctx.state.dead) return;
    const dmg = (payload && typeof payload.amount === "number") ? payload.amount : 10;
    ctx.state.health = Math.max(0, ctx.state.health - dmg);
    if (ctx.state.health <= 0) {
      ctx.state.dead = true;
      ctx.state.deadUntil = ctx.time.elapsed + (ctx.state.respawnDelay || 5);
      // Hide the corpse out of the way until respawn.
      ctx.scene.setPosition(entity.id, [entity.position[0], -200, entity.position[2]]);
      ctx.events.emit("kill", { killerId: fromId, victimId: entity.id, victimIsPlayer: false });
    }
  });
};

exports.update = function(entity, ctx) {
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
    }
    return;
  }

  const player = ctx.scene.find("Player");
  if (!player) return;

  // Steer toward player horizontally only — keep enemies grounded on the
  // map's nav surface; vertical drift handled by their kinematic Y init.
  const dx = player.position[0] - entity.position[0];
  const dz = player.position[2] - entity.position[2];
  const distSq = dx * dx + dz * dz;
  const dist = Math.sqrt(distSq);

  // Update seek target (player position projected to enemy's Y).
  ctx.state.seek.target.set(player.position[0], entity.position[1], player.position[2]);
  // If we're close enough, halt to avoid stutter.
  if (dist < STOP_DISTANCE) {
    ctx.state.vehicle.velocity.set(0, 0, 0);
  } else {
    // Step Yuka one tick.
    ctx.state.entityManager.update(ctx.time.delta);
    // Write back to the entity. Preserve Y from the entity so we don't
    // drift due to numeric noise.
    entity.position[0] = ctx.state.vehicle.position.x;
    entity.position[2] = ctx.state.vehicle.position.z;
    // Face direction of travel.
    if (Math.abs(ctx.state.vehicle.velocity.x) + Math.abs(ctx.state.vehicle.velocity.z) > 0.01) {
      entity.rotation[1] = Math.atan2(ctx.state.vehicle.velocity.x, ctx.state.vehicle.velocity.z);
    }
  }

  // Ranged attack — line-of-sight optional; we only check distance + cooldown.
  if (dist < ATTACK_RANGE && ctx.time.elapsed - ctx.state.lastAttack >= ATTACK_COOLDOWN) {
    ctx.state.lastAttack = ctx.time.elapsed;
    ctx.scene.send(player.id, "damage", { amount: ATTACK_DAMAGE, fromId: entity.id });
    ctx.events.emit("enemyAttack", { fromId: entity.id, targetId: player.id });
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
// Registry
// ──────────────────────────────────────────────────────────────────────────────

export const BUILTIN_BEHAVIORS: Record<BehaviorKind, string> = {
  "player-deathmatch": PLAYER_DEATHMATCH,
  "enemy-deathmatch": ENEMY_DEATHMATCH,
  "gamemode-deathmatch": GAMEMODE_DEATHMATCH,
  spawnpoint: "// marker — no behavior",
};
