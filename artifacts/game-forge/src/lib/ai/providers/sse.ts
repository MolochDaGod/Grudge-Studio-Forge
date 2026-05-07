/**
 * Shared SSE→event-iterator. Both providers POST and read the same
 * `data: {json}\n\n` shape, so the parser lives here.
 *
 * Aborting via `signal` cancels the underlying reader and returns
 * cleanly — `runConversation` swallows that as a user-initiated stop.
 */
import type { ProviderEvent } from "./types";

export async function* readSSE(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncIterable<ProviderEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const onAbort = () => {
    try {
      reader.cancel().catch(() => undefined);
    } catch {
      /* already closed */
    }
  };
  if (signal) {
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }
  let buf = "";
  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const json = line.slice(5).trim();
          if (!json) continue;
          try {
            const ev = JSON.parse(json) as ProviderEvent;
            if (ev && typeof ev === "object" && typeof ev.type === "string") {
              yield ev;
            }
          } catch {
            // skip malformed event
          }
        }
      }
    }
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}
