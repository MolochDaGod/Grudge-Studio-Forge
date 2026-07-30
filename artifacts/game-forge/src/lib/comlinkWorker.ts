/**
 * Thin Comlink helper for dedicated workers (collider bake, convert, etc.).
 * Keeps worker plumbing consistent without rewriting every call site at once.
 */
import * as Comlink from "comlink";

/** Wrap a new Worker with Comlink.remote. */
export function wrapWorker<T>(worker: Worker): Comlink.Remote<T> {
  return Comlink.wrap<T>(worker);
}

/** Expose an API object from inside a worker module. */
export function exposeWorkerApi<T extends object>(api: T): void {
  Comlink.expose(api);
}

export { Comlink };
