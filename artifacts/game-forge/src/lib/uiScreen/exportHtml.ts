/**
 * Serialize a `UIScreen` to a single self-contained `index.html` string.
 *
 * The exported file is fully standalone — it pulls Google Fonts via a
 * `<link>`, inlines the entire Grudge theme stylesheet, and emits each
 * widget as the SAME markup `widgets.tsx` renders in the editor preview
 * (sans React) so what-you-see is what-you-export.
 *
 * Round-trip is intentionally one-way (export only). Re-importing HTML
 * is not supported in PR-1 — the source of truth is the JSON in the
 * `uiScreens` store.
 */
import type {
  Widget,
  UIScreen,
  PanelProps,
  TextProps,
  BarProps,
  ButtonProps,
  CircleButtonProps,
  HotbarProps,
  ImageProps,
} from "./types";
import { GRUDGE_THEME_CSS, FONT_LINK_HREF } from "./theme";

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function styleAttr(parts: Record<string, string | number | undefined>): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(parts)) {
    if (v === undefined || v === "") continue;
    out.push(`${k}:${typeof v === "number" ? `${v}px` : v}`);
  }
  return out.join(";");
}

function pos(w: Widget, extra: Record<string, string | number | undefined> = {}) {
  return styleAttr({ left: w.x, top: w.y, width: w.w, height: w.h, ...extra });
}

function rivetSpans(): string {
  return (
    `<span class="gw-rivet tl"></span>` +
    `<span class="gw-rivet tr"></span>` +
    `<span class="gw-rivet bl"></span>` +
    `<span class="gw-rivet br"></span>`
  );
}

function serializeWidget(w: Widget): string {
  switch (w.type) {
    case "panel": {
      const p = w.props as unknown as PanelProps;
      return `<div class="gw-w gw-panel gw-panel-${p.variant ?? "stone"}" style="${pos(w, { padding: p.padding ?? 12 })}">${p.rivets === false ? "" : rivetSpans()}</div>`;
    }
    case "text": {
      const p = w.props as unknown as TextProps;
      const justify =
        p.align === "center"
          ? "center"
          : p.align === "right"
            ? "flex-end"
            : "flex-start";
      return `<div class="gw-w gw-text size-${p.size ?? "md"}" style="${pos(w, {
        color: p.color ?? "#f5e2c1",
        "font-weight": p.weight ?? 400,
        "justify-content": justify,
      })}"><span>${esc(p.content ?? "")}</span></div>`;
    }
    case "bar": {
      const p = w.props as unknown as BarProps;
      const value = Math.max(0, Math.min(100, p.value ?? 0));
      const lbl = p.showLabel === false
        ? ""
        : `<div class="gw-bar-lbl">${esc(p.label ?? (p.kind ?? "hp").toUpperCase())} ${Math.round(value)}%</div>`;
      return `<div class="gw-w gw-bar kind-${p.kind ?? "hp"}" style="${pos(w)}"><div class="gw-bar-fill" style="width:${value}%"></div>${lbl}</div>`;
    }
    case "button": {
      const p = w.props as unknown as ButtonProps;
      const key = p.keyHint ? `<span class="gw-key">${esc(p.keyHint)}</span>` : "";
      return `<div class="gw-w" style="${pos(w)}"><button type="button" class="gw-btn variant-${p.variant ?? "primary"}">${key}${esc(p.label ?? "")}</button></div>`;
    }
    case "circle-button": {
      const p = w.props as unknown as CircleButtonProps;
      const key = p.keyHint ? `<span class="gw-key">${esc(p.keyHint)}</span>` : "";
      return `<div class="gw-w" style="${pos(w)}"><button type="button" class="gw-cbtn ${p.active ? "is-active" : ""}">${esc(p.glyph ?? "?")}${key}</button></div>`;
    }
    case "hotbar": {
      const p = w.props as unknown as HotbarProps;
      const slots = Math.max(1, Math.min(12, p.slots ?? 8));
      const showKeys = p.showKeys !== false;
      let inner = "";
      for (let i = 0; i < slots; i++) {
        const k = showKeys ? `<span class="gw-key">${i + 1}</span>` : "";
        inner += `<div class="gw-hotbar-slot">${k}</div>`;
      }
      return `<div class="gw-w gw-hotbar" style="${pos(w, { gap: p.gap ?? 4 })}">${inner}</div>`;
    }
    case "image": {
      const p = w.props as unknown as ImageProps;
      const inner = p.src
        ? `<img src="${esc(p.src)}" alt="${esc(p.alt ?? "")}">`
        : `<div class="gw-image-empty">Image</div>`;
      return `<div class="gw-w gw-image fit-${p.fit ?? "contain"}" style="${pos(w)}">${inner}</div>`;
    }
  }
}

export function serializeScreenToHtml(screen: UIScreen): string {
  const body = screen.widgets.map(serializeWidget).join("\n    ");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${esc(screen.name)} • Grudge UI</title>
  <link rel="stylesheet" href="${FONT_LINK_HREF}" />
  <style>
${GRUDGE_THEME_CSS}
  body { margin: 0; background: #0a0705; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  .gw-screen-wrap { box-shadow: 0 0 40px rgba(0,0,0,.8); }
  </style>
</head>
<body>
  <div class="gw-screen-wrap">
    <div class="gw-screen" style="width:${screen.width}px;height:${screen.height}px">
    ${body}
    </div>
  </div>
</body>
</html>`;
}

/** Trigger a browser download of the serialized HTML. */
export function downloadScreenHtml(screen: UIScreen) {
  if (typeof window === "undefined") return;
  const html = serializeScreenToHtml(screen);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safeName = screen.name.replace(/[^a-z0-9-_]+/gi, "_") || "screen";
  a.download = `${safeName}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
