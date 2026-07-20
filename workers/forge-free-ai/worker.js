/**
 * grudge-forge-free-ai — same-origin free OpenAI-compatible proxy.
 *
 * Route: forge.grudge-studio.com/api/free-ai/*
 * Secrets (optional if client sends X-Api-Key BYOK):
 *   GROQ_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY,
 *   CEREBRAS_API_KEY, DEEPSEEK_API_KEY, TOGETHER_API_KEY
 */
const PROVIDERS = {
  groq: {
    base: "https://api.groq.com/openai/v1",
    env: "GROQ_API_KEY",
  },
  openrouter: {
    base: "https://openrouter.ai/api/v1",
    env: "OPENROUTER_API_KEY",
  },
  gemini: {
    base: "https://generativelanguage.googleapis.com/v1beta/openai",
    env: "GEMINI_API_KEY",
  },
  cerebras: {
    base: "https://api.cerebras.ai/v1",
    env: "CEREBRAS_API_KEY",
  },
  deepseek: {
    base: "https://api.deepseek.com",
    env: "DEEPSEEK_API_KEY",
  },
  together: {
    base: "https://api.together.xyz/v1",
    env: "TOGETHER_API_KEY",
  },
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Api-Key, X-Title, HTTP-Referer",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");

    // Health / status (no secrets)
    if (
      (path.endsWith("/api/free-ai/status") || path.endsWith("/status")) &&
      request.method === "GET"
    ) {
      const available = {};
      for (const [id, p] of Object.entries(PROVIDERS)) {
        available[id] = Boolean(env[p.env]);
      }
      return json({
        ok: true,
        service: "grudge-forge-free-ai",
        providers: available,
        byok: true,
        hint: "Send X-Api-Key for BYOK, or set server secrets for shared free keys.",
      });
    }

    if (
      !(path.endsWith("/api/free-ai/chat") || path.endsWith("/chat")) ||
      request.method !== "POST"
    ) {
      return json({ error: "Not found. POST /api/free-ai/chat" }, 404);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const providerId =
      url.searchParams.get("provider") || body.provider || "groq";
    const p = PROVIDERS[providerId];
    if (!p) {
      return json(
        {
          error: `Unknown provider '${providerId}'`,
          known: Object.keys(PROVIDERS),
        },
        400,
      );
    }

    const userKey = request.headers.get("X-Api-Key") || request.headers.get("x-api-key");
    const apiKey = (userKey && userKey.trim()) || env[p.env];
    if (!apiKey) {
      return json(
        {
          error: `No API key for ${providerId}. Paste a free key in the AI Worker panel or set ${p.env} on the worker.`,
          signup: providerId,
        },
        401,
      );
    }

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return json({ error: "Missing messages[]" }, 400);
    }

    const model = typeof body.model === "string" ? body.model : undefined;
    if (!model) {
      return json({ error: "Missing model" }, 400);
    }

    const upstreamBody = {
      model,
      messages: body.messages,
      stream: body.stream !== false,
      max_tokens: Math.min(Number(body.max_tokens) || 8192, 16384),
    };
    if (Array.isArray(body.tools) && body.tools.length > 0) {
      upstreamBody.tools = body.tools;
      upstreamBody.tool_choice = body.tool_choice ?? "auto";
    }

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    // OpenRouter optional rankings
    if (providerId === "openrouter") {
      headers["HTTP-Referer"] = "https://forge.grudge-studio.com";
      headers["X-Title"] = "Grudge Forge";
    }

    let upstream;
    try {
      upstream = await fetch(`${p.base}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(upstreamBody),
      });
    } catch (err) {
      return json(
        { error: `Upstream ${providerId} failed: ${err.message || String(err)}` },
        502,
      );
    }

    // Non-stream or error: forward JSON
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "");
      return new Response(text || JSON.stringify({ error: `Upstream ${upstream.status}` }), {
        status: upstream.status,
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    // Stream passthrough (OpenAI SSE)
    if (upstreamBody.stream && upstream.body) {
      return new Response(upstream.body, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          ...CORS,
        },
      });
    }

    const data = await upstream.text();
    return new Response(data, {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  },
};
