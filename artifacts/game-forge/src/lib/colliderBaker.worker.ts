/// <reference lib="webworker" />
/**
 * Off-main-thread V-HACD baker. The wasm module is ~6 MB and a single
 * decomposition can take seconds, so we run the whole core in a
 * dedicated worker. The wasm decomposer is cached at module scope
 * inside the worker (see {@link getDecomposer}) so the load cost is
 * paid once per worker, not once per call.
 *
 * Wire protocol — see `BakeRequest` / `BakeResponse` in
 * `colliderBaker.ts`. Hull vertex/index buffers are transferred (not
 * copied) back to the main thread via `postMessage(..., transfers)`.
 */
import { bakeSoups, type MeshSoup } from "./colliderBakerCore";

interface BakeRequest {
  id: number;
  soups: MeshSoup[];
  options: { maxHulls?: number; minHullVolume?: number };
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (ev: MessageEvent<BakeRequest>) => {
  const { id, soups, options } = ev.data;
  try {
    const result = await bakeSoups(soups, options, (message, detail) => {
      ctx.postMessage({
        id,
        type: "warn",
        message,
        detail: detail === undefined ? undefined : String(detail),
      });
    });
    const transfers: ArrayBuffer[] = [];
    for (const h of result.hulls) {
      transfers.push(h.vertices.buffer as ArrayBuffer);
      if (h.indices) transfers.push(h.indices.buffer as ArrayBuffer);
    }
    ctx.postMessage(
      { id, type: "result", hulls: result.hulls, totalVerts: result.totalVerts },
      transfers,
    );
  } catch (err) {
    ctx.postMessage({ id, type: "error", error: String(err) });
  }
};
