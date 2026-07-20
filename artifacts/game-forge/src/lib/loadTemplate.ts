/**
 * Streaming template loader with a real progress signal.
 *
 * Why this isn't just `fetch().then(r => r.json())`:
 *
 * Templates live in object storage and can be tens to a few hundred KB.
 * On a slow network the user just sees a frozen "Loading…" while the
 * payload trickles in. By consuming `response.body` as a `ReadableStream`
 * and dividing bytes-received by `Content-Length`, we get a determinate
 * progress signal that the dialog can render as a real progress bar.
 *
 * Progress contract (matches the dialog's expectations):
 *   - First emit is `{ phase: "indeterminate", received: 0, total: null }`
 *     fired immediately. The dialog suppresses the bar for the first
 *     150ms (anti-flash for cached responses) before flipping to the
 *     determinate %.
 *   - Once headers arrive we emit a `headers` event with `total` (or
 *     null if no Content-Length). All later `progress` events carry
 *     `received` and `total`; ratio is clamped to [0, 0.99] until the
 *     reader signals done.
 *   - On done we emit `{ phase: "complete", received: total, total }`
 *     and the dialog jumps to 100% then holds for ~250ms before closing.
 *   - On abort (user clicks Cancel → AbortController.abort()) the
 *     promise rejects with a `DOMException` of name "AbortError" — the
 *     caller distinguishes this from a real failure and stays silent.
 */
import type { SceneData } from "@workspace/scene-schema";
import { getGetTemplateUrl } from "@workspace/api-client-react";

export type TemplateLoadProgress =
  | { phase: "indeterminate"; received: 0; total: null }
  | { phase: "headers"; received: 0; total: number | null }
  | { phase: "progress"; received: number; total: number | null }
  | { phase: "complete"; received: number; total: number | null };

export class TemplateLoadError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly templateKey?: string,
  ) {
    super(message);
    this.name = "TemplateLoadError";
  }
}

export interface LoadTemplateOptions {
  signal?: AbortSignal;
  onProgress?: (p: TemplateLoadProgress) => void;
}

export async function loadTemplateWithProgress(
  key: string,
  opts: LoadTemplateOptions = {},
): Promise<SceneData> {
  const { signal, onProgress } = opts;

  // Prime the dialog with an indeterminate tick *before* the network
  // call settles. Without this the picker freezes for ~50-200ms before
  // any UI reacts — and indeterminate-then-determinate feels much more
  // responsive than "nothing, then a sudden 73%".
  onProgress?.({ phase: "indeterminate", received: 0, total: null });

  // API Worker first (production), then static files under /builtin/templates/
  const candidates = [
    getGetTemplateUrl(key),
    `/builtin/templates/${encodeURIComponent(key)}.json`,
    `/builtin/templates/${encodeURIComponent(key)}`,
  ];
  let response: Response | null = null;
  let lastStatus: number | undefined;
  let lastDetail = "";
  try {
    for (const url of candidates) {
      response = await fetch(url, { signal });
      if (response.ok) break;
      lastStatus = response.status;
      try {
        lastDetail = (await response.text()).slice(0, 200);
      } catch {
        lastDetail = "";
      }
      response = null;
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new TemplateLoadError(
      `Network error loading template "${key}": ${(err as Error).message}`,
      undefined,
      key,
    );
  }

  if (!response?.ok) {
    throw new TemplateLoadError(
      `Server returned ${lastStatus ?? "error"} for template "${key}"${
        lastDetail ? `: ${lastDetail}` : ""
      }`,
      lastStatus,
      key,
    );
  }

  const totalHeader = response.headers.get("Content-Length");
  const total = totalHeader ? Number(totalHeader) : null;
  // total can come back as NaN for transfer-encoded responses; treat
  // those identically to a missing header (indeterminate).
  const safeTotal = total != null && Number.isFinite(total) && total > 0 ? total : null;

  onProgress?.({ phase: "headers", received: 0, total: safeTotal });

  if (!response.body) {
    // Older runtimes (or some test environments) don't expose a body
    // stream. Fall back to the all-at-once path; we still get the
    // headers tick for the dialog and the complete tick at the end.
    const data = (await response.json()) as SceneData;
    onProgress?.({
      phase: "complete",
      received: safeTotal ?? 0,
      total: safeTotal,
    });
    return data;
  }

  // Read the body chunk-by-chunk. We accumulate raw bytes (rather than
  // decoding incrementally) because the parser at the end needs the
  // full string anyway, and TextDecoder.decode({ stream: true }) is
  // measurably more allocation than a single concat.
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.byteLength;
        onProgress?.({ phase: "progress", received, total: safeTotal });
      }
    }
  } catch (err) {
    // Reader.read() rejects with AbortError when the user aborts mid-stream.
    if ((err as Error).name === "AbortError") throw err;
    throw new TemplateLoadError(
      `Stream interrupted loading template "${key}": ${(err as Error).message}`,
      undefined,
      key,
    );
  }

  // Concatenate to a single Uint8Array, then decode + parse. Two passes
  // (concat → decode) is unavoidable when we need both progress and a
  // valid JSON parse at the end.
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder("utf-8").decode(merged);
  let data: SceneData;
  try {
    data = JSON.parse(text) as SceneData;
  } catch (err) {
    throw new TemplateLoadError(
      `Template "${key}" returned invalid JSON: ${(err as Error).message}`,
      undefined,
      key,
    );
  }

  onProgress?.({
    phase: "complete",
    received,
    total: safeTotal ?? received,
  });

  return data;
}
