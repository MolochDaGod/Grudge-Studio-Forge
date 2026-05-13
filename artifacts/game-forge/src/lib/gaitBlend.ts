/**
 * Pure math for velocity-driven gait blending.
 *
 * Replaces the discrete "pick one clip and crossfade" model with a
 * continuous mix of idle / walk / run weights driven by the rigid
 * body's horizontal speed. The three weights always sum to 1.0 so
 * the AnimationMixer's per-action `setEffectiveWeight` produces a
 * stable additive pose.
 *
 * Crossover regions (linear ramps):
 *   [0, walkSpeed]            : idle ⇆ walk
 *   [walkSpeed, runSpeed]     : walk ⇆ run
 *   speed > runSpeed          : run = 1
 *
 * Why linear ramps, not smoothstep: linear weights at constant
 * speed produce a constant pose, which is what the player visually
 * expects ("if I'm at half-walk I want a half-walk pose"). Smooth-
 * step would cluster the visual blend toward the endpoints and feel
 * unresponsive at intermediate speeds.
 */

export interface GaitWeights {
  idle: number;
  walk: number;
  run: number;
}

export function computeGaitWeights(
  speed: number,
  walkSpeed: number,
  runSpeed: number,
): GaitWeights {
  // Defensive: NaN / negative speed → fully idle. A common source of
  // NaN is a freshly-spawned rigid body whose `linvel()` hasn't been
  // populated yet on the first frame.
  if (!Number.isFinite(speed) || speed <= 0) {
    return { idle: 1, walk: 0, run: 0 };
  }
  // Defensive: caller passed degenerate thresholds. Treat as "always
  // run" rather than divide-by-zero in the ramp math below.
  if (walkSpeed <= 0 || runSpeed <= walkSpeed) {
    return { idle: 0, walk: 0, run: 1 };
  }

  if (speed <= walkSpeed) {
    const t = speed / walkSpeed;
    return { idle: 1 - t, walk: t, run: 0 };
  }
  if (speed <= runSpeed) {
    const t = (speed - walkSpeed) / (runSpeed - walkSpeed);
    return { idle: 0, walk: 1 - t, run: t };
  }
  return { idle: 0, walk: 0, run: 1 };
}

/**
 * Body lean math driven by linear / angular velocity.
 *
 * `forwardLean` (radians, +pitch = nose-down): when the character
 * accelerates forward we lean forward; when running and turning, the
 * body banks. Currently we lean proportional to forward-speed
 * fraction of run speed, so a sprinting character pitches forward
 * the most. Capped at ±maxPitch to avoid the "mortal kombat fatality
 * lean" look.
 *
 * `rollLean` (radians, +roll = right-side down): set from yaw rate
 * (angular velocity around world Y). A character spinning to the
 * right banks INTO the turn (right-side down). Capped at ±maxRoll.
 */
export interface LeanInput {
  /** Horizontal speed magnitude in m/s. */
  speed: number;
  /** Yaw angular velocity in rad/s (positive = turning left). */
  angularVelocity: number;
  /** Run speed used to scale the forward-lean ramp. */
  runSpeed: number;
  /** Maximum forward pitch in radians (default ±10°). */
  maxPitch?: number;
  /** Maximum roll in radians (default ±15°). */
  maxRoll?: number;
  /** Yaw-rate (rad/s) at which roll saturates to maxRoll. Tuned so
   *  a normal player turn (≈π/2 per second) produces ~half of the
   *  cap, and a sharp pivot saturates. */
  rollSaturationRate?: number;
}

export interface LeanOutput {
  forwardPitch: number;
  rollLean: number;
}

const DEG = Math.PI / 180;
const DEFAULT_MAX_PITCH = 10 * DEG;
const DEFAULT_MAX_ROLL = 15 * DEG;
const DEFAULT_ROLL_SATURATION = Math.PI; // π rad/s

export function computeBodyLean(input: LeanInput): LeanOutput {
  const maxPitch = input.maxPitch ?? DEFAULT_MAX_PITCH;
  const maxRoll = input.maxRoll ?? DEFAULT_MAX_ROLL;
  const rollSat = input.rollSaturationRate ?? DEFAULT_ROLL_SATURATION;

  // Forward pitch: ramps from 0 at idle to maxPitch at runSpeed.
  // Clamped, so over-runSpeed (sprint with buff, etc.) doesn't
  // pitch the avatar past its skeleton's tolerance.
  let forwardPitch = 0;
  if (Number.isFinite(input.speed) && input.speed > 0 && input.runSpeed > 0) {
    const t = Math.min(1, input.speed / input.runSpeed);
    forwardPitch = t * maxPitch;
  }

  // Roll: angular velocity → bank into the turn. Right turn (negative
  // yaw rate in three.js convention since +Y rotation is left) banks
  // the right side DOWN, i.e. positive roll. So roll has the OPPOSITE
  // sign of angular velocity.
  let rollLean = 0;
  if (Number.isFinite(input.angularVelocity) && rollSat > 0) {
    const t = Math.max(-1, Math.min(1, -input.angularVelocity / rollSat));
    rollLean = t * maxRoll;
  }

  return { forwardPitch, rollLean };
}
