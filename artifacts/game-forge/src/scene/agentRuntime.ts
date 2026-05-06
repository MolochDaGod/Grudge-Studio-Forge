/**
 * Per-entity nav-agent state machine.
 *
 * Each entity carrying a {@link NavAgentComponent} on it spins up one
 * XState v5 machine in play mode. The state graph is intentionally
 * small and game-shaped:
 *
 *   Idle ─┬─► Patrol ─┬─► Chase ─┬─► Stuck
 *         │           │          ├─► Climb
 *         │           │          └─► Swim
 *         │           └──► Idle
 *         └─► Dead   (terminal — kill removes the actor)
 *
 *   * Idle / Patrol are reactive baseline states.
 *   * Chase is entered when a script (or AI tool) calls
 *     `agent(id).chase(targetId)` or sets a direct destination.
 *   * Climb / Swim are entered automatically by the runtime tick when
 *     the agent's foot-probe userData reads `surface === "Climb" |
 *     "Swim"` — keeps gameplay surface tagging in lockstep with the
 *     FSM.
 *   * Stuck fires when the navmesh rejects findPath three frames in a
 *     row; recovery (re-sample nearest poly) brings us back to Patrol.
 *   * Dead is terminal and exposes a `dead` clip cue to the renderer.
 *
 * Animation crossfade map: each state maps to a clip name the
 * EntityRenderer's animation mixer can crossfade in. The map is
 * overridable via {@link NavAgentComponent.animationClips} so users
 * with non-standard rigs (zombie set, alien set) don't have to rename
 * the underlying clips.
 */
import { setup, createActor, type AnyActorRef } from "xstate";
import type { NavAgentComponent } from "@workspace/scene-schema";

export type AgentStateName =
  | "idle"
  | "patrol"
  | "chase"
  | "attack"
  | "climb"
  | "swim"
  | "stuck"
  | "dead";

interface AgentContext {
  /** Most recent destination set by a script or AI tool. */
  destination: [number, number, number] | null;
  /** Optional pursuit / attack target id (entity tracked by Chase /
   *  Attack). */
  targetId: string | null;
  /** Number of consecutive failed `findPath` attempts. Three in a row
   *  flips the agent to Stuck. */
  failedPathTries: number;
  /** Surface the agent's foot probe last reported (driven by the
   *  runtime tick). */
  currentSurface: "Walk" | "Jump" | "Climb" | "Swim" | "Dig" | "None";
}

export type AgentEvent =
  | { type: "patrol" }
  | { type: "chase"; targetId: string }
  | { type: "moveTo"; destination: [number, number, number] }
  /** Engage an enemy at melee/ranged distance — drives the FSM into
   *  the dedicated `attack` state so the renderer can crossfade to
   *  the attack clip and gameplay code can consume the state name. */
  | { type: "attack"; targetId: string }
  | { type: "stop" }
  | { type: "kill" }
  | { type: "pathFailed" }
  | { type: "pathFound" }
  /** Force a re-plan from Stuck (or any state) by clearing the
   *  failed-tries counter and bouncing back into Chase against the
   *  current `destination` / `targetId`. The runtime drives this when
   *  it re-samples a nearby walkable poly after Stuck. */
  | { type: "replan" }
  | { type: "surface"; surface: AgentContext["currentSurface"] };

const STUCK_THRESHOLD = 3;

/** Default state→clip map. Overridden per-agent via
 *  {@link NavAgentComponent.animationClips}. */
const DEFAULT_CLIP_MAP: Record<AgentStateName, string> = {
  idle: "idle",
  patrol: "walk",
  chase: "run",
  attack: "attack",
  climb: "climb",
  swim: "swim",
  stuck: "idle",
  dead: "dead",
};

export function clipForState(
  state: AgentStateName,
  overrides?: NavAgentComponent["animationClips"],
): string {
  return (
    (overrides?.[
      state === "patrol"
        ? "walk"
        : state === "chase"
          ? "run"
          : (state as keyof NonNullable<NavAgentComponent["animationClips"]>)
    ] as string | undefined) ?? DEFAULT_CLIP_MAP[state]
  );
}

/** Build the XState v5 machine config for a single agent. We use
 *  `setup()` to thread the discriminated event/context types through
 *  for full inference at the call site. */
export const agentMachine = setup({
  types: {
    context: {} as AgentContext,
    events: {} as AgentEvent,
  },
  guards: {
    // Surface guards read the *event* payload — context isn't yet
    // updated when the child state's transition resolves (XState v5
    // resolves child transitions before parent assign-only handlers).
    onClimbSurface: ({ event }) =>
      event.type === "surface" && event.surface === "Climb",
    onSwimSurface: ({ event }) =>
      event.type === "surface" && event.surface === "Swim",
    notOnClimb: ({ event }) =>
      event.type !== "surface" || event.surface !== "Climb",
    notOnSwim: ({ event }) =>
      event.type !== "surface" || event.surface !== "Swim",
    pathHopeless: ({ context }) => context.failedPathTries + 1 >= STUCK_THRESHOLD,
  },
}).createMachine({
  id: "agent",
  initial: "idle",
  context: {
    destination: null,
    targetId: null,
    failedPathTries: 0,
    currentSurface: "None",
  },
  on: {
    kill: { target: ".dead" },
    // Global re-plan: any state (except `dead`) drops to `chase` with
    // counters cleared. Used by the runtime when it manages to snap a
    // nearby walkable poly after a Stuck stall.
    replan: {
      target: ".chase",
      actions: ({ context }) => {
        context.failedPathTries = 0;
      },
    },
    // Global attack: jumps the FSM straight into `attack` no matter
    // which non-terminal state we're in (the renderer drives the
    // attack-swing crossfade purely off the state name).
    attack: {
      target: ".attack",
      actions: ({ context, event }) => {
        if (event.type === "attack") context.targetId = event.targetId;
      },
    },
    surface: {
      actions: ({ context, event }) => {
        context.currentSurface = event.surface;
      },
    },
  },
  states: {
    idle: {
      on: {
        patrol: { target: "patrol" },
        chase: {
          target: "chase",
          actions: ({ context, event }) => {
            context.targetId = event.targetId;
          },
        },
        moveTo: {
          target: "chase",
          actions: ({ context, event }) => {
            context.destination = event.destination;
            context.targetId = null;
          },
        },
      },
    },
    patrol: {
      on: {
        stop: { target: "idle" },
        chase: {
          target: "chase",
          actions: ({ context, event }) => {
            context.targetId = event.targetId;
          },
        },
        moveTo: {
          target: "chase",
          actions: ({ context, event }) => {
            context.destination = event.destination;
            context.targetId = null;
          },
        },
        pathFailed: [
          { guard: "pathHopeless", target: "stuck" },
          {
            actions: ({ context }) => {
              context.failedPathTries += 1;
            },
          },
        ],
        surface: [
          { guard: "onClimbSurface", target: "climb" },
          { guard: "onSwimSurface", target: "swim" },
          {
            actions: ({ context, event }) => {
              context.currentSurface = event.surface;
            },
          },
        ],
      },
    },
    chase: {
      entry: ({ context }) => {
        context.failedPathTries = 0;
      },
      on: {
        stop: { target: "idle" },
        // Continuous pursuit: Viewport pumps the target's live position
        // back in as `moveTo` while we're chasing. Update destination
        // (and clear targetId so the planner uses the world-space dest)
        // without leaving the chase state.
        moveTo: {
          actions: ({ context, event }) => {
            context.destination = event.destination;
          },
        },
        chase: {
          actions: ({ context, event }) => {
            context.targetId = event.targetId;
          },
        },
        pathFound: {
          actions: ({ context }) => {
            context.failedPathTries = 0;
          },
        },
        pathFailed: [
          { guard: "pathHopeless", target: "stuck" },
          {
            actions: ({ context }) => {
              context.failedPathTries += 1;
            },
          },
        ],
        surface: [
          { guard: "onClimbSurface", target: "climb" },
          { guard: "onSwimSurface", target: "swim" },
          {
            actions: ({ context, event }) => {
              context.currentSurface = event.surface;
            },
          },
        ],
      },
    },
    climb: {
      on: {
        stop: { target: "idle" },
        surface: [
          // Recovered to a normal walkable surface — drop back to
          // chase if we still had a destination, else Patrol.
          {
            guard: "notOnClimb",
            target: "chase",
            actions: ({ context, event }) => {
              context.currentSurface = event.surface;
            },
          },
        ],
      },
    },
    swim: {
      on: {
        stop: { target: "idle" },
        surface: [
          {
            guard: "notOnSwim",
            target: "chase",
            actions: ({ context, event }) => {
              context.currentSurface = event.surface;
            },
          },
        ],
      },
    },
    stuck: {
      on: {
        // Anything that gives us a viable path again pulls us out.
        pathFound: { target: "chase" },
        moveTo: {
          target: "chase",
          actions: ({ context, event }) => {
            context.destination = event.destination;
            context.failedPathTries = 0;
          },
        },
        stop: { target: "idle" },
      },
    },
    attack: {
      // Attack is a non-locomotion state — the renderer plays the
      // attack clip, and gameplay code transitions out of it on its
      // own (e.g. `agent.chase(targetId)` after the swing) or via
      // `agent.stop()`. We still honour surface→Climb/Swim retargets
      // so an attack interrupted by a water/cliff transition recovers.
      on: {
        stop: { target: "idle" },
        chase: {
          target: "chase",
          actions: ({ context, event }) => {
            context.targetId = event.targetId;
          },
        },
        moveTo: {
          target: "chase",
          actions: ({ context, event }) => {
            context.destination = event.destination;
            context.targetId = null;
          },
        },
        surface: [
          { guard: "onClimbSurface", target: "climb" },
          { guard: "onSwimSurface", target: "swim" },
          {
            actions: ({ context, event }) => {
              context.currentSurface = event.surface;
            },
          },
        ],
      },
    },
    dead: { type: "final" },
  },
});

/** Inputs to the per-frame locomotion tick. The Viewport owns position
 *  resolution (Rapier translation vs Object3D position) and navmesh
 *  binding, then asks the actor what velocity it wants this frame. */
export interface AgentTickInput {
  position: [number, number, number];
  dt: number;
  /** Path planner bound to the loaded navmesh + the agent's
   *  `areaFilter`. May be omitted when no navmesh is loaded — the
   *  agent then falls back to straight-line steering toward the
   *  destination, which is good enough for unbounded scenes. */
  plan?: (
    start: [number, number, number],
    end: [number, number, number],
  ) => [number, number, number][] | null;
}

export interface AgentTickResult {
  /** Desired horizontal velocity (m/s) for this frame. Y is left at 0
   *  so the caller can preserve gravity-driven vertical velocity on
   *  Rapier dynamic bodies. */
  velocity: [number, number, number];
  /** True the frame the agent reaches the final waypoint — Viewport
   *  uses this to decide whether to clear linvel and re-park the FSM. */
  reached: boolean;
}

/** Per-entity actor handle returned to the runtime + script API. */
export interface AgentActor {
  ref: AnyActorRef;
  state(): AgentStateName;
  send(event: AgentEvent): void;
  currentClip(): string;
  isStuck(): boolean;
  /** Per-frame locomotion driver. Plans/replans against the supplied
   *  navmesh-aware `plan` callback, advances the current waypoint when
   *  the agent gets within `arriveRadius`, and returns the desired
   *  velocity. Idle / Stuck / Dead / Attack states return zero so the
   *  body parks in place. */
  tick(input: AgentTickInput): AgentTickResult;
  stop(): void;
}

/** Spin up an agent. Kept tiny so the runtime can store one per
 *  entity in a plain `Map<entityId, AgentActor>`. */
export function spawnAgent(component: NavAgentComponent | undefined): AgentActor {
  const actor = createActor(agentMachine);
  actor.start();
  // Locomotion sidecar — kept outside the XState context because path
  // arrays mutate every tick and putting them in `assign` would force
  // a context replacement on every waypoint advance.
  let path: [number, number, number][] | null = null;
  let waypointIdx = 0;
  let lastDestKey = "";
  // Speed + arrival radius come from the component (with sane defaults
  // so a freshly-added agent without authored values still walks).
  const speed = component?.speed ?? 4;
  const arriveRadius = 0.4;
  // Reset path state on `replan` so the next tick rebuilds the corridor.
  actor.subscribe((snap) => {
    void snap;
  });
  const handle: AgentActor = {
    ref: actor,
    state: () => actor.getSnapshot().value as AgentStateName,
    send: (e) => {
      if (e.type === "replan" || e.type === "moveTo" || e.type === "chase") {
        path = null;
        waypointIdx = 0;
        lastDestKey = "";
      }
      actor.send(e);
    },
    currentClip: () =>
      clipForState(
        actor.getSnapshot().value as AgentStateName,
        component?.animationClips,
      ),
    isStuck: () => (actor.getSnapshot().value as AgentStateName) === "stuck",
    tick: ({ position, plan }) => {
      const snap = actor.getSnapshot();
      const stateName = snap.value as AgentStateName;
      // States that should not drive locomotion.
      if (
        stateName === "idle" ||
        stateName === "stuck" ||
        stateName === "dead" ||
        stateName === "attack"
      ) {
        return { velocity: [0, 0, 0], reached: false };
      }
      const ctx = snap.context as AgentContext;
      const dest = ctx.destination;
      if (!dest) return { velocity: [0, 0, 0], reached: false };
      const destKey = `${dest[0].toFixed(2)},${dest[1].toFixed(2)},${dest[2].toFixed(2)}`;
      if (destKey !== lastDestKey || !path) {
        lastDestKey = destKey;
        waypointIdx = 0;
        path = plan ? plan(position, dest) : null;
        // No navmesh / off-mesh endpoints — straight-line fallback so
        // the agent still chases (visible motion is better than a
        // standstill while the user iterates on bake settings).
        if (!path) path = [dest];
      }
      // Advance through reached waypoints.
      while (waypointIdx < path.length) {
        const wp = path[waypointIdx];
        const dx = wp[0] - position[0];
        const dz = wp[2] - position[2];
        if (Math.hypot(dx, dz) <= arriveRadius) waypointIdx++;
        else break;
      }
      if (waypointIdx >= path.length) {
        // Reached final destination — park and let the FSM consumer
        // decide whether to drop back to idle / patrol.
        return { velocity: [0, 0, 0], reached: true };
      }
      const wp = path[waypointIdx];
      const dx = wp[0] - position[0];
      const dz = wp[2] - position[2];
      const len = Math.hypot(dx, dz) || 1;
      return {
        velocity: [(dx / len) * speed, 0, (dz / len) * speed],
        reached: false,
      };
    },
    stop: () => actor.stop(),
  };
  return handle;
}
