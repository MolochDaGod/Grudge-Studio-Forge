/**
 * Grudge Warlords theme stylesheet — emitted as a single CSS string so the
 * SAME styles drive both the editor preview (injected once via a global
 * `<style>` tag) and the exported standalone HTML (inlined in the file).
 *
 * Class prefix `gw-` (Grudge Warlords) avoids collisions with the editor's
 * own Tailwind classes when the preview renders inside the editor shell.
 *
 * Source palette / patterns are lifted from the user-supplied mockups:
 *   attached_assets/mainpanel_*.html (gold-on-stone panel + rivets)
 *   attached_assets/UIlayer_*.html  (HUD overlay hotbar + circle buttons)
 */

export const FONT_LINK_HREF =
  "https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900&family=Crimson+Text:ital,wght@0,400;0,600;0,700;1,400&family=JetBrains+Mono:wght@400;700&display=swap";

export const GRUDGE_THEME_CSS = `
:root {
  --gw-gold: #c5a059;
  --gw-gold-bright: #d4a400;
  --gw-gold-glow: rgba(197,160,89,.35);
  --gw-text: #f5e2c1;
  --gw-muted: #9b7d52;
  --gw-dim: #6b5535;
  --gw-panel: #1a120c;
  --gw-panel2: #221710;
  --gw-panel3: #2e1f14;
  --gw-border-dim: #3a2a1a;
  --gw-slot: #1e140e;
  --gw-bg: #0a0705;
  --gw-hp1: #8b2020; --gw-hp2: #d44040;
  --gw-mp1: #1a3a6a; --gw-mp2: #3a7ad8;
  --gw-sp1: #5a6a1a; --gw-sp2: #9ab830;
  --gw-xp1: #6a4a1a; --gw-xp2: #d4a040;
  --gw-font-display: 'Cinzel', Georgia, serif;
  --gw-font-body: 'Crimson Text', Georgia, serif;
  --gw-font-mono: 'JetBrains Mono', ui-monospace, monospace;
}

.gw-screen {
  position: relative;
  font-family: var(--gw-font-body);
  color: var(--gw-text);
  background:
    radial-gradient(ellipse 900px 400px at 10% 0%, rgba(197,160,89,.06), transparent),
    radial-gradient(ellipse 700px 500px at 90% 100%, rgba(140,40,20,.06), transparent),
    linear-gradient(170deg, #120c06 0%, #0a0705 40%, #080604 100%);
  overflow: hidden;
}

.gw-w { position: absolute; box-sizing: border-box; }

/* ── Panel ───────────────────────────────────── */
.gw-panel {
  background: linear-gradient(150deg,#1e140e 0%,#120c06 60%,#0f0805 100%);
  border: 2px solid var(--gw-gold);
  border-radius: 12px;
  box-shadow:
    inset 0 0 20px rgba(0,0,0,.5),
    0 0 0 1px rgba(197,160,89,.1),
    0 6px 24px rgba(0,0,0,.6);
}
.gw-panel.gw-panel-dark {
  background: linear-gradient(180deg, var(--gw-panel), var(--gw-bg));
  border-color: var(--gw-border-dim);
}
.gw-panel.gw-panel-ghost {
  background: rgba(26,18,12,.55);
  border-color: rgba(197,160,89,.35);
  backdrop-filter: blur(2px);
}
.gw-rivet {
  position: absolute; width: 7px; height: 7px;
  background: var(--gw-gold); border: 1px solid #fff;
  box-shadow: 0 0 4px var(--gw-gold); border-radius: 1px;
}
.gw-rivet.tl { top: 3px; left: 3px; }
.gw-rivet.tr { top: 3px; right: 3px; }
.gw-rivet.bl { bottom: 3px; left: 3px; }
.gw-rivet.br { bottom: 3px; right: 3px; }

/* ── Text ────────────────────────────────────── */
.gw-text { display: flex; align-items: center; line-height: 1.2; }
.gw-text.size-sm    { font-size: 11px; }
.gw-text.size-md    { font-size: 14px; }
.gw-text.size-lg    { font-size: 18px; }
.gw-text.size-title { font-family: var(--gw-font-display); font-size: 22px; letter-spacing: 2px; text-transform: uppercase; color: var(--gw-gold); font-weight: 700; }

/* ── Bar ─────────────────────────────────────── */
.gw-bar {
  background: #0a0805;
  border: 1px solid var(--gw-border-dim);
  border-radius: 3px; overflow: hidden; position: relative;
}
.gw-bar > .gw-bar-fill { height: 100%; transition: width .4s ease; }
.gw-bar.kind-hp > .gw-bar-fill { background: linear-gradient(90deg,var(--gw-hp1),var(--gw-hp2)); }
.gw-bar.kind-mp > .gw-bar-fill { background: linear-gradient(90deg,var(--gw-mp1),var(--gw-mp2)); }
.gw-bar.kind-sp > .gw-bar-fill { background: linear-gradient(90deg,var(--gw-sp1),var(--gw-sp2)); }
.gw-bar.kind-xp > .gw-bar-fill { background: linear-gradient(90deg,var(--gw-xp1),var(--gw-xp2)); }
.gw-bar > .gw-bar-lbl {
  position: absolute; inset: 0; text-align: center;
  font: 700 9px var(--gw-font-mono); line-height: inherit;
  color: #fff; text-shadow: 0 1px 2px #000;
  display: flex; align-items: center; justify-content: center;
}

/* ── Button (rect) ───────────────────────────── */
.gw-btn {
  width: 100%; height: 100%;
  font-family: var(--gw-font-display); font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 1.5px;
  color: var(--gw-text); cursor: pointer;
  background: linear-gradient(180deg, #2a1e14, #1a0f08);
  border: 1.5px solid var(--gw-gold); border-radius: 6px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 2px 6px rgba(0,0,0,.5);
  transition: transform .1s, box-shadow .15s, border-color .15s;
  display: inline-flex; align-items: center; justify-content: center;
  position: relative;
}
.gw-btn:hover { box-shadow: inset 0 1px 0 rgba(255,255,255,.12), 0 0 12px var(--gw-gold-glow); }
.gw-btn:active { transform: translateY(1px); }
.gw-btn.variant-secondary { border-color: var(--gw-border-dim); color: var(--gw-muted); }
.gw-btn.variant-ghost { border-color: rgba(197,160,89,.4); background: rgba(26,18,12,.4); }
.gw-btn .gw-key { position:absolute; top:2px; right:5px; font: 700 8px var(--gw-font-mono); color: var(--gw-muted); }

/* ── Circle Button ───────────────────────────── */
.gw-cbtn {
  width: 100%; height: 100%;
  border-radius: 50%;
  background: radial-gradient(#333,#000);
  border: 2px solid var(--gw-gold);
  display: flex; align-items: center; justify-content: center;
  color: var(--gw-gold); font-weight: 700; font-size: 16px;
  box-shadow: 0 4px 6px rgba(0,0,0,.5); cursor: pointer;
  transition: background .15s, box-shadow .15s, transform .1s;
  position: relative;
}
.gw-cbtn:hover { background: rgba(197,160,89,.15); }
.gw-cbtn.is-active {
  background: radial-gradient(rgba(197,160,89,.35), #111);
  box-shadow: 0 0 14px var(--gw-gold-glow);
  color: #fff;
}
.gw-cbtn .gw-key { position:absolute; bottom:-12px; left:50%; transform:translateX(-50%); font: 700 8px var(--gw-font-mono); color: var(--gw-muted); }

/* ── Hotbar ──────────────────────────────────── */
.gw-hotbar {
  display: flex; align-items: center; gap: 4px;
  padding: 8px;
  background: linear-gradient(to bottom, #2a2a2a, #111);
  border: 2px solid var(--gw-gold); border-radius: 8px;
  box-shadow:
    inset 0 0 10px #000,
    inset 1px 1px 0 rgba(255,255,255,.15),
    0 0 10px rgba(0,0,0,.7);
}
.gw-hotbar-slot {
  flex: 1; aspect-ratio: 1;
  background: #000;
  border: 2px solid #444;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 700; font-size: 18px;
  box-shadow: inset 0 0 5px #000;
  position: relative; cursor: pointer;
  transition: transform .1s, border-color .15s;
}
.gw-hotbar-slot:hover { border-color: var(--gw-gold); transform: scale(1.05); }
.gw-hotbar-slot .gw-key { position:absolute; top:2px; left:4px; font: 700 9px var(--gw-font-mono); color: #aaa; }

/* ── Image ───────────────────────────────────── */
.gw-image {
  width: 100%; height: 100%; overflow: hidden;
  border: 1px solid var(--gw-border-dim); border-radius: 6px;
  background: #0f0805;
}
.gw-image > img { width: 100%; height: 100%; display: block; }
.gw-image.fit-contain > img { object-fit: contain; }
.gw-image.fit-cover   > img { object-fit: cover; }
.gw-image.fit-fill    > img { object-fit: fill; }
.gw-image .gw-image-empty {
  width:100%; height:100%; display:flex; align-items:center; justify-content:center;
  color: var(--gw-dim); font-size: 11px; font-family: var(--gw-font-display);
  letter-spacing: 1px; text-transform: uppercase;
  border: 2px dashed var(--gw-border-dim); border-radius: 6px;
}
`;

/** Inject the theme stylesheet once into the editor's document head. */
let injected = false;
export function ensureGrudgeThemeInjected() {
  if (typeof document === "undefined" || injected) return;
  injected = true;
  if (!document.querySelector("link[data-gw-fonts]")) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONT_LINK_HREF;
    link.setAttribute("data-gw-fonts", "1");
    document.head.appendChild(link);
  }
  const style = document.createElement("style");
  style.setAttribute("data-gw-theme", "1");
  style.textContent = GRUDGE_THEME_CSS;
  document.head.appendChild(style);
}
