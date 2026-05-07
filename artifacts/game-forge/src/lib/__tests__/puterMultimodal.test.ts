/**
 * Mirror unit-test for the server-side `translateContentForPuter` helper.
 *
 * The function lives in `artifacts/api-server/src/lib/puterServerClient.ts`
 * but api-server has no vitest harness — this file imports the source
 * directly via a relative path so we still get coverage for the
 * Anthropic→Puter multimodal bridge that screenshot tools depend on.
 */
import { describe, it, expect } from "vitest";
import { translateContentForPuter } from "../../../../api-server/src/lib/puterServerClient";

describe("translateContentForPuter (server multimodal bridge)", () => {
  it("returns plain string for plain string input", () => {
    expect(translateContentForPuter("hello")).toBe("hello");
  });

  it("flattens text-only content array to a string", () => {
    expect(
      translateContentForPuter([
        { type: "text", text: "hello" },
        { type: "text", text: "world" },
      ]),
    ).toBe("hello\nworld");
  });

  it("preserves Anthropic image blocks as Puter image_url data URLs", () => {
    const png = "iVBORw0KGgo=";
    const out = translateContentForPuter([
      { type: "text", text: "look at this" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: png },
      },
    ]);
    expect(Array.isArray(out)).toBe(true);
    const arr = out as Array<{ type: string; image_url?: { url: string }; text?: string }>;
    expect(arr).toHaveLength(2);
    expect(arr[0]).toEqual({ type: "text", text: "look at this" });
    expect(arr[1].type).toBe("image_url");
    expect(arr[1].image_url?.url).toBe(`data:image/png;base64,${png}`);
  });

  it("walks into tool_result content arrays to surface nested images", () => {
    const png = "AAAA";
    const out = translateContentForPuter([
      {
        type: "tool_result",
        tool_use_id: "tu_1",
        content: [
          { type: "text", text: '{"ok":true}' },
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: png },
          },
        ],
      },
    ]);
    expect(Array.isArray(out)).toBe(true);
    const arr = out as Array<{ type: string }>;
    expect(arr.map((p) => p.type)).toEqual(["text", "image_url"]);
  });

  it("passes through pre-translated image_url blocks unchanged", () => {
    const out = translateContentForPuter([
      { type: "image_url", image_url: { url: "https://example.com/x.png" } },
    ]);
    expect(out).toEqual([
      { type: "image_url", image_url: { url: "https://example.com/x.png" } },
    ]);
  });

  it("represents tool_use blocks as a textual marker", () => {
    expect(
      translateContentForPuter([
        { type: "tool_use", id: "tu_1", name: "capture_viewport", input: {} },
      ]),
    ).toBe("[assistant called tool capture_viewport]");
  });

  it("ignores unknown block types instead of crashing", () => {
    expect(
      translateContentForPuter([
        { type: "weird", payload: 42 },
        { type: "text", text: "ok" },
      ]),
    ).toBe("ok");
  });
});
