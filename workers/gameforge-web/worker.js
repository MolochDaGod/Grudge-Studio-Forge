/**
 * grudge-gameforge-web — production edge for forge.grudge-studio.com
 *
 * Routes:
 *   /__edge/health     JSON probe of ORIGIN + API_ORIGIN (not SPA HTML)
 *   /api/health        alias → API /api/healthz (forge api-server)
 *   /api/free-ai/*     pass-through (route on free-ai worker or same host)
 *   /api/*             → API_ORIGIN (Railway forge-api)
 *   /assets-cdn/*      → ASSETS_ORIGIN (optional)
 *   /_framework/*      SPA origin + long-cache + correct wasm MIME
 *   /*                 SPA ORIGIN (Vercel / prebuilt static)
 *
 * Bindings (vars): ORIGIN, API_ORIGIN, ASSETS_ORIGIN (optional)
 */

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function applySecurityHeaders(res, extra = {}) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  for (const [k, v] of Object.entries(extra)) {
    if (v == null) out.headers.delete(k);
    else out.headers.set(k, v);
  }
  // Never leak internal origin host rewrites
  out.headers.delete("x-powered-by");
  return out;
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...SECURITY_HEADERS,
      ...extra,
    },
  });
}

/**
 * Proxy to an absolute origin, preserving path/query (optional strip prefix).
 */
async function proxyTo(request, targetOrigin, { stripPrefix = "", rewritePath } = {}) {
  const url = new URL(request.url);
  const target = new URL(targetOrigin);
  if (rewritePath) {
    target.pathname = rewritePath;
  } else {
    let path = url.pathname;
    if (stripPrefix && path.startsWith(stripPrefix)) {
      path = path.slice(stripPrefix.length) || "/";
    }
    target.pathname = path;
  }
  target.search = url.search;

  const headers = new Headers(request.headers);
  headers.set("Host", target.host);
  // Avoid leaking CF client IP quirks as Host
  headers.delete("cf-connecting-ip");

  const init = {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual",
    // @ts-expect-error duplex for streaming body in CF workers
    duplex: request.method === "GET" || request.method === "HEAD" ? undefined : "half",
  };

  return fetch(target.toString(), init);
}

function cacheHeadersForPath(pathname) {
  // Blazor / .NET runtime — content-addressed enough to cache hard after ship
  if (pathname.startsWith("/_framework/")) {
    if (pathname.endsWith(".wasm")) {
      return {
        "Content-Type": "application/wasm",
        "Cache-Control": "public, max-age=31536000, immutable",
      };
    }
    if (pathname.endsWith(".js") || pathname.endsWith(".json") || pathname.endsWith(".br")) {
      return { "Cache-Control": "public, max-age=86400" };
    }
    return { "Cache-Control": "public, max-age=3600" };
  }
  // Builtin GLBs / static assets
  if (
    pathname.startsWith("/builtin/") ||
    pathname.startsWith("/assets/") ||
    /\.(glb|gltf|webp|png|jpg|jpeg|svg|woff2?)$/i.test(pathname)
  ) {
    return { "Cache-Control": "public, max-age=604800, stale-while-revalidate=86400" };
  }
  // SPA shell — short cache so deploys roll out
  if (pathname === "/" || pathname === "/editor" || pathname.endsWith(".html")) {
    return { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" };
  }
  return {};
}

async function probe(url, timeoutMs = 4000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: ctrl.signal,
      headers: { Accept: "application/json, text/plain, */*" },
    });
    const text = await res.text().catch(() => "");
    return {
      ok: res.ok,
      status: res.status,
      bytes: text.length,
      sample: text.slice(0, 120),
    };
  } catch (err) {
    return { ok: false, status: 0, error: err.message || String(err) };
  } finally {
    clearTimeout(t);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // ── Edge health (must never return SPA HTML) ─────────────────────
    if (path === "/__edge/health" || path === "/__edge/healthz") {
      const origin = (env.ORIGIN || "").replace(/\/$/, "");
      const api = (env.API_ORIGIN || "").replace(/\/$/, "");
      const assets = (env.ASSETS_ORIGIN || "").replace(/\/$/, "");
      // Never probe the same hostname (self-fetch loops → 522 on CF).
      // Forge JSON API is the separate worker grudge-gameforge-api.
      const forgeApi =
        (env.FORGE_API_ORIGIN || "https://grudge-gameforge-api.grudge.workers.dev").replace(
          /\/$/,
          "",
        );

      const [spa, forgeApiHealth, originApi, blazorBoot] = await Promise.all([
        origin ? probe(`${origin}/`) : Promise.resolve({ ok: false, error: "ORIGIN unset" }),
        probe(`${forgeApi}/api/healthz`).then(async (r) =>
          r.ok ? r : probe(`${forgeApi}/api/health`),
        ),
        api
          ? probe(`${api}/api/healthz`).then(async (r) =>
              r.ok ? r : probe(`${api}/api/health`),
            )
          : Promise.resolve({ ok: false, error: "API_ORIGIN unset" }),
        origin
          ? probe(`${origin}/_framework/blazor.boot.json`)
          : Promise.resolve({ ok: false, error: "ORIGIN unset" }),
      ]);

      const healthy = Boolean(spa.ok && forgeApiHealth.ok);
      return json(
        {
          ok: healthy,
          service: "grudge-gameforge-web",
          time: new Date().toISOString(),
          bindings: {
            ORIGIN: origin || null,
            API_ORIGIN: api || null,
            ASSETS_ORIGIN: assets || null,
          },
          probes: {
            spa,
            /** GameForge JSON API worker (not self-host — avoids CF 522 loop). */
            forgeApi: forgeApiHealth,
            /** Optional Railway binding (may be a different fleet service). */
            apiOrigin: originApi,
            blazorBoot,
          },
          hybrid: {
            blazorBootOk: Boolean(blazorBoot.ok),
            note: "Compare blazorBoot sample hash to local public/_framework after hybrid C# deploys",
          },
        },
        healthy ? 200 : 503,
      );
    }

    // ── API health alias ────────────────────────────────────────────────
    // Prefer Forge JSON API worker (/api/healthz), then Railway API_ORIGIN.
    // Live grudge-gameforge-api historically only exposed /api/healthz (not /health).
    if (path === "/api/health" || path === "/api/health/") {
      const forgeApi = (env.FORGE_API_ORIGIN || "").replace(/\/+$/, "");
      const rail = (env.API_ORIGIN || "").replace(/\/+$/, "");
      const tryOrigins = [forgeApi, rail].filter(Boolean);
      let last = null;
      for (const origin of tryOrigins) {
        for (const rewrite of ["/api/healthz", "/api/health"]) {
          try {
            const res = await proxyTo(request, origin, { rewritePath: rewrite });
            if (res.ok) {
              return applySecurityHeaders(res, { "Cache-Control": "no-store" });
            }
            last = res;
          } catch {
            /* try next */
          }
        }
      }
      if (last) return applySecurityHeaders(last, { "Cache-Control": "no-store" });
      return json(
        { status: "ok", service: "grudge-gameforge-web", note: "edge alias (upstream unreachable)" },
        200,
      );
    }

    // ── Free AI is a separate worker route in CF; if traffic hits this
    // worker first, optional FREE_AI_ORIGIN can forward. ────────────────
    if (path.startsWith("/api/free-ai/") && env.FREE_AI_ORIGIN) {
      const res = await proxyTo(request, env.FREE_AI_ORIGIN, { stripPrefix: "" });
      return applySecurityHeaders(res, { "Cache-Control": "no-store" });
    }

    // ── JSON API → Railway ───────────────────────────────────────────
    if (path.startsWith("/api/")) {
      if (!env.API_ORIGIN) return json({ error: "API_ORIGIN unset" }, 500);
      const res = await proxyTo(request, env.API_ORIGIN);
      return applySecurityHeaders(res, { "Cache-Control": "no-store" });
    }

    // ── Optional CDN prefix ──────────────────────────────────────────
    if (path.startsWith("/assets-cdn/") && env.ASSETS_ORIGIN) {
      const res = await proxyTo(request, env.ASSETS_ORIGIN, { stripPrefix: "/assets-cdn" });
      return applySecurityHeaders(res, cacheHeadersForPath(path));
    }

    // ── SPA + static (Vercel / prebuilt ORIGIN) ──────────────────────
    if (!env.ORIGIN) return json({ error: "ORIGIN unset" }, 500);
    const res = await proxyTo(request, env.ORIGIN);
    const extra = cacheHeadersForPath(path);

    // Force wasm MIME even if origin is wrong (old Vercel / misconfigured)
    if (path.endsWith(".wasm") && !res.headers.get("content-type")?.includes("wasm")) {
      extra["Content-Type"] = "application/wasm";
    }

    return applySecurityHeaders(res, extra);
  },
};
