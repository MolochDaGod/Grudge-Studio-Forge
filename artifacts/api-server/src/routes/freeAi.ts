/**
 * Free OpenAI-compatible proxy (Groq, OpenRouter, Gemini, Cerebras, …).
 * Mirrors the Cloudflare `grudge-forge-free-ai` worker so local api-server
 * and Railway deploys support the same client contract.
 */
import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";

const router: IRouter = Router();


/** Groq rejects >128 tools: "'tools' : maximum number of items is 128". */
const PROVIDER_TOOL_CAPS: Record<string, number> = {
  groq: 128,
  cerebras: 128,
  gemini: 128,
  deepseek: 128,
  together: 128,
  openrouter: 128,
};

const GROQ_MODEL_ALIASES: Record<string, string> = {
  "llama-3.1-8b-instant": "openai/gpt-oss-20b",
  "llama-3.3-70b-versatile": "openai/gpt-oss-120b",
  "gemma2-9b-it": "openai/gpt-oss-20b",
  "qwen-qwq-32b": "qwen/qwen3.6-27b",
  "llama-3.1-70b-versatile": "openai/gpt-oss-120b",
  "qwen/qwen3-32b": "qwen/qwen3.6-27b",
};

function resolveUpstreamModel(providerId: string, model: string | null) {
  if (!model) return model;
  if (providerId === "groq" && GROQ_MODEL_ALIASES[model]) {
    return GROQ_MODEL_ALIASES[model];
  }
  return model;
}

const CORE_TOOL_NAMES = [
  "get_scene_summary",
  "list_entities",
  "list_fast_assets",
  "spawn_fast_asset",
  "search_fleet_assets",
  "list_builtin_models",
  "add_model_entity",
  "update_entity",
  "delete_entity",
  "verify_scene_full",
  "diagnose_scene",
];

function toolNameOf(t: unknown): string {
  if (!t || typeof t !== "object") return "";
  const o = t as { name?: string; function?: { name?: string } };
  return String(o.function?.name || o.name || "");
}

function capToolsForProvider(
  tools: unknown[],
  providerId: string,
  messages: unknown,
): unknown[] {
  const cap = PROVIDER_TOOL_CAPS[providerId] ?? 256;
  if (!Array.isArray(tools) || tools.length <= cap) return tools;
  const hay = JSON.stringify(messages || []).toLowerCase();
  const used = new Set<string>();
  const msgs = Array.isArray(messages) ? messages : [];
  for (const m of msgs) {
    const rec = m as { name?: string; tool_calls?: Array<{ name?: string; function?: { name?: string } }> };
    for (const tc of rec.tool_calls || []) {
      const n = tc?.function?.name || tc?.name;
      if (n) used.add(String(n));
    }
    if (typeof rec.name === "string") used.add(rec.name);
  }
  const scored = tools.map((t, i) => {
    const n = toolNameOf(t);
    let score = 0;
    if (used.has(n)) score += 1000;
    if (CORE_TOOL_NAMES.includes(n)) score += 500;
    const nl = n.toLowerCase();
    if (nl && hay.includes(nl)) score += 200;
    for (const w of nl.split(/[_-]/)) {
      if (w.length > 3 && hay.includes(w)) score += 8;
    }
    return { t, i, score };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, cap).map((x) => x.t);
}

const PROVIDERS: Record<
  string,
  { base: string; env: string }
> = {
  groq: { base: "https://api.groq.com/openai/v1", env: "GROQ_API_KEY" },
  openrouter: {
    base: "https://openrouter.ai/api/v1",
    env: "OPENROUTER_API_KEY",
  },
  gemini: {
    base: "https://generativelanguage.googleapis.com/v1beta/openai",
    env: "GEMINI_API_KEY",
  },
  cerebras: { base: "https://api.cerebras.ai/v1", env: "CEREBRAS_API_KEY" },
  deepseek: { base: "https://api.deepseek.com", env: "DEEPSEEK_API_KEY" },
  together: { base: "https://api.together.xyz/v1", env: "TOGETHER_API_KEY" },
};

router.get("/free-ai/status", (_req, res) => {
  const available: Record<string, boolean> = {};
  for (const [id, p] of Object.entries(PROVIDERS)) {
    available[id] = Boolean(process.env[p.env]?.trim());
  }
  res.json({
    ok: true,
    service: "api-server-free-ai",
    providers: available,
    byok: true,
  });
});

router.post("/free-ai/chat", async (req, res) => {
  const providerId =
    (typeof req.query.provider === "string" && req.query.provider) ||
    (typeof req.body?.provider === "string" && req.body.provider) ||
    "groq";
  const p = PROVIDERS[providerId];
  if (!p) {
    res.status(400).json({
      error: `Unknown provider '${providerId}'`,
      known: Object.keys(PROVIDERS),
    });
    return;
  }

  const userKey =
    req.header("x-api-key") ||
    (typeof req.header("authorization") === "string" &&
    req.header("authorization")!.toLowerCase().startsWith("bearer ")
      ? req.header("authorization")!.slice(7)
      : null);
  const apiKey = (userKey && userKey.trim()) || process.env[p.env]?.trim();
  if (!apiKey) {
    res.status(401).json({
      error: `No API key for ${providerId}. Paste a free key in the AI Worker or set ${p.env}.`,
      signup: providerId,
    });
    return;
  }

  const body = req.body ?? {};
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    res.status(400).json({ error: "Missing messages[]" });
    return;
  }
  const model = resolveUpstreamModel(
    providerId,
    typeof body.model === "string" ? body.model : null,
  );
  if (!model) {
    res.status(400).json({ error: "Missing model" });
    return;
  }

  const stream = body.stream !== false;
  const upstreamBody: Record<string, unknown> = {
    model,
    messages: body.messages,
    stream,
    max_tokens: Math.min(Number(body.max_tokens) || 8192, 16384),
  };
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    upstreamBody.tools = capToolsForProvider(body.tools, providerId, body.messages);
    upstreamBody.tool_choice = body.tool_choice ?? "auto";
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (providerId === "openrouter") {
    headers["HTTP-Referer"] = "https://forge.grudge-studio.com";
    headers["X-Title"] = "Grudge Forge";
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${p.base}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(upstreamBody),
    });
  } catch (err) {
    logger.error({ err, providerId }, "free-ai upstream failed");
    res.status(502).json({
      error: `Upstream ${providerId} failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    res.status(upstream.status).type("json").send(text || `{"error":"upstream ${upstream.status}"}`);
    return;
  }

  if (stream && upstream.body) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
    } finally {
      res.end();
    }
    return;
  }

  const data = await upstream.text();
  res.type("json").send(data);
});

export default router;
