const urls = [
  "https://forge.grudge-studio.com/",
  "https://forge.grudge-studio.com/editor",
  "https://assets.grudge-studio.com/forge/",
  "https://assets.grudge-studio.com/forge/index.html",
  "https://assets.grudge-studio.com/forge-spa/index.html",
];

for (const u of urls) {
  try {
    const r = await fetch(u, { cache: "no-store", redirect: "follow" });
    const t = await r.text();
    const hasRoot = t.includes('id="root"') || t.includes("id='root'");
    const isStub = t.includes("Full editor JS not in this deploy");
    const hasViteAssets =
      /src="\/assets\//.test(t) ||
      /type="module"[^>]*src="\/assets\//.test(t) ||
      /assets\/index-/.test(t);
    console.log({
      u,
      status: r.status,
      final: r.url,
      hasRoot,
      isStub,
      hasViteAssets,
      title: (t.match(/<title>([^<]*)/) || [])[1],
      len: t.length,
    });
  } catch (e) {
    console.log({ u, err: e.message });
  }
}
