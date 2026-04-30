// Yuka 0.7.x ships without TypeScript declarations. We expose the namespace
// as an opaque module — scripts treat it as an untyped library and the
// engine itself doesn't introspect Yuka types. Anything stricter would
// require maintaining a full hand-written type surface for ~40 classes.
declare module "yuka" {
  const yuka: Record<string, unknown> & {
    Vector3: new (x?: number, y?: number, z?: number) => {
      x: number; y: number; z: number;
      set(x: number, y: number, z: number): unknown;
      copy(v: { x: number; y: number; z: number }): unknown;
      sub(v: { x: number; y: number; z: number }): unknown;
      length(): number;
      normalize(): unknown;
    };
    Vehicle: new () => {
      position: { x: number; y: number; z: number; copy: (v: unknown) => void };
      maxSpeed: number;
      steering: { add(b: unknown): unknown; remove(b: unknown): unknown };
      update(dt: number): void;
    };
    SeekBehavior: new (target?: unknown) => { target: unknown };
    EntityManager: new () => { add(e: unknown): void; update(dt: number): void };
    [k: string]: unknown;
  };
  export = yuka;
}
