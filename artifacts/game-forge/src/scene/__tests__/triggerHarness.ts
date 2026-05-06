import { vi } from "vitest";
import { TriggerInbox } from "../GameBus";
import type { CompiledScript, ScriptContext } from "../csTranspile";

/** Minimal JS compiler matching `PlayRuntime.compileJs` (kept private there
 *  to avoid exporting test-only seams from the runtime module). */
export function compileJsForTest(code: string): CompiledScript {
  const factory = new Function(
    "exports",
    `"use strict"; const module = { exports }; ${code}\nreturn module.exports;`,
  ) as (exports: Record<string, unknown>) => Record<string, unknown>;
  const exportsObj: Record<string, unknown> = {};
  const mod = factory(exportsObj);
  return {
    start: typeof mod.start === "function" ? (mod.start as CompiledScript["start"]) : undefined,
    update: typeof mod.update === "function" ? (mod.update as CompiledScript["update"]) : undefined,
  };
}

/** Build a stub ScriptContext rich enough to exercise the pickup behavior:
 *  registers `onEnterTrigger`, fires through a real {@link TriggerInbox},
 *  and surfaces the `events.emit` + `scene.despawn` calls as spies for
 *  assertion. The other surface methods are no-ops since the pickup
 *  behavior never touches them. */
export function makePickupContext(): {
  ctx: ScriptContext & { triggers: TriggerInbox };
  despawn: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
} {
  const triggers = new TriggerInbox();
  const despawn = vi.fn((_id: string) => true);
  const emit = vi.fn();
  const noop = () => {};

  const ctx = {
    time: { delta: 1 / 60, elapsed: 0 },
    input: { keys: {}, mouse: { x: 0, y: 0, dx: 0, dy: 0, left: false, right: false, middle: false, locked: false } },
    scene: {
      find: () => undefined,
      findAll: () => [],
      findById: () => undefined,
      setPosition: () => false,
      castRay: () => null,
      findEntitiesByLayer: () => [],
      send: noop,
      on: noop,
      onEnterTrigger: (h) => triggers.registerEnter("pickup-1", h),
      onExitTrigger: (h) => triggers.registerExit("pickup-1", h),
      despawn,
      cameraPosition: () => [0, 0, 0] as [number, number, number],
      cameraDirection: () => [0, 0, -1] as [number, number, number],
      freeze: noop,
      unfreeze: noop,
      parentOf: () => undefined,
      childrenOf: () => [],
      descendantsOf: () => [],
      findChildren: () => [],
      worldPosition: () => [0, 0, 0] as [number, number, number],
    },
    events: { emit, on: noop },
    state: {},
    // yuka is unused by the pickup behavior; cast to satisfy the interface.
    yuka: {} as ScriptContext["yuka"],
    log: noop,
  } satisfies ScriptContext;

  return { ctx: Object.assign(ctx, { triggers }), despawn, emit };
}
