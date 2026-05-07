import { describe, it, expect } from "vitest";
import { readSSE } from "../sse";

function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(ctrl) {
      if (i >= chunks.length) {
        ctrl.close();
        return;
      }
      ctrl.enqueue(enc.encode(chunks[i++]));
    },
  });
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iter) out.push(v);
  return out;
}

describe("readSSE", () => {
  it("parses well-formed event-stream", async () => {
    const events = await collect(
      readSSE(
        streamFrom([
          'data: {"type":"text_delta","text":"hi"}\n\n',
          'data: {"type":"stop","stop_reason":"end_turn"}\n\n',
        ]),
      ),
    );
    expect(events).toEqual([
      { type: "text_delta", text: "hi" },
      { type: "stop", stop_reason: "end_turn" },
    ]);
  });

  it("survives chunked event boundaries", async () => {
    const events = await collect(
      readSSE(
        streamFrom([
          'data: {"type":"te',
          'xt_delta","text":"abc"}\n\ndata: {"type":"stop","stop_reason":"end_turn"}\n\n',
        ]),
      ),
    );
    expect(events.map((e) => e.type)).toEqual(["text_delta", "stop"]);
  });

  it("skips malformed JSON lines without throwing", async () => {
    const events = await collect(
      readSSE(
        streamFrom([
          "data: not-json\n\n",
          'data: {"type":"text_delta","text":"ok"}\n\n',
        ]),
      ),
    );
    expect(events).toEqual([{ type: "text_delta", text: "ok" }]);
  });

  it("aborts cleanly when the signal fires before reading", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const events = await collect(
      readSSE(streamFrom(['data: {"type":"text_delta","text":"x"}\n\n']), ctrl.signal),
    );
    expect(events).toEqual([]);
  });
});
