#!/usr/bin/env node
/**
 * Production smoke tests for forge.grudge-studio.com.
 * Exit 0 = healthy, 1 = regression.
 *
 *   node scripts/smoke-forge-prod.mjs
 *   FORGE_BASE=https://grudge-studio-forge.vercel.app node scripts/smoke-forge-prod.mjs
 */
const BASE = (process.env.FORGE_BASE || "https://forge.grudge-studio.com").replace(
  /\/+$/,
  "",
);

const checks = [];

function ok(name, detail = "") {
  checks.push({ name, pass: true, detail });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, detail = "") {
  checks.push({ name, pass: false, detail });
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

async function get(path, opts = {}) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const r = await fetch(url, {
    cache: "no-store",
    redirect: "follow",
    ...opts,
  });
  const text = await r.text();
  return { r, text, url };
}

console.log(`\nForge smoke · ${BASE}\n`);

// 1. Landing SPA
{
  const { r, text } = await get("/");
  if (r.status === 200 && text.includes('id="root"') && /assets\/index-/.test(text)) {
    ok("GET / SPA shell", r.status);
  } else {
    fail("GET / SPA shell", `status=${r.status} root=${text.includes("id=\"root\"")}`);
  }
  if (text.includes("Full editor JS not in this deploy")) {
    fail("GET / not a stub");
  } else {
    ok("GET / not a stub deploy");
  }
}

// 2. Client routes must rewrite to index.html (not Vercel NOT_FOUND)
for (const path of ["/editor", "/projects/demo-smoke"]) {
  const { r, text } = await get(path);
  if (r.status === 200 && text.includes('id="root"') && /assets\/index-/.test(text)) {
    ok(`GET ${path} SPA rewrite`, r.status);
  } else {
    fail(
      `GET ${path} SPA rewrite`,
      `status=${r.status} body=${text.slice(0, 80).replace(/\s+/g, " ")}`,
    );
  }
}

// 3. Free AI proxy
{
  const { r, text } = await get("/api/free-ai/status");
  if (r.status === 200) {
    try {
      const j = JSON.parse(text);
      ok(
        "GET /api/free-ai/status",
        `byok=${j.byok} providers=${JSON.stringify(j.providers || {})}`,
      );
    } catch {
      fail("GET /api/free-ai/status", "invalid JSON");
    }
  } else {
    fail("GET /api/free-ai/status", `status=${r.status}`);
  }
}

// 4. Core API (projects list — may be empty; edge worker is occasionally flaky)
{
  let passed = false;
  let last = "";
  for (let i = 0; i < 3; i++) {
    const { r, text } = await get("/api/projects");
    last = `status=${r.status} bytes=${text.length}`;
    if (r.status === 200 && (text.startsWith("[") || text.startsWith("{"))) {
      ok("GET /api/projects", last);
      passed = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  if (!passed) fail("GET /api/projects", last);
}

// 5. Templates
{
  const { r, text } = await get("/api/templates");
  if (r.status === 200 && text.includes("key")) {
    ok("GET /api/templates");
  } else {
    fail("GET /api/templates", `status=${r.status}`);
  }
}

// 6. R2 CDN sample (large assets path)
{
  const { r } = await get(
    "https://assets.grudge-studio.com/builtin/map-mistytown.glb",
    { method: "HEAD" },
  );
  // Some CDNs reject HEAD — fall back to range GET
  if (r.status === 200 || r.status === 206) {
    ok("R2 builtin map-mistytown.glb", String(r.status));
  } else {
    const g = await fetch(
      "https://assets.grudge-studio.com/builtin/map-mistytown.glb",
      {
        headers: { Range: "bytes=0-0" },
        cache: "no-store",
      },
    );
    if (g.status === 200 || g.status === 206) {
      ok("R2 builtin map-mistytown.glb", `range ${g.status}`);
    } else {
      fail("R2 builtin map-mistytown.glb", `status=${g.status}`);
    }
  }
}

const failed = checks.filter((c) => !c.pass);
console.log(
  `\n${checks.length - failed.length}/${checks.length} passed` +
    (failed.length ? ` · ${failed.length} failed` : " · all good") +
    "\n",
);
process.exit(failed.length ? 1 : 0);
