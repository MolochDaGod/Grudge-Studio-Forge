/**
 * forge.grudge-studio.com landing page.
 *
 * Dark cinematic design showcasing Grudge Forge's capabilities.
 * Serves as the public-facing page before users launch the editor.
 */
import { useLocation } from "wouter";
import { useEffect, useState } from "react";
import {
  Box, Cpu, Layers, Wand2, Download, ArrowRight, Zap,
  Globe, Wifi, WifiOff, MonitorPlay, Gamepad2, Code2,
  Sparkles, Shield, Palette, ChevronRight,
} from "lucide-react";

const FONTS = {
  display: "'Cinzel', 'Playfair Display', serif",
  body: "'Inter', 'Jost', sans-serif",
  mono: "'JetBrains Mono', 'Fira Code', monospace",
};

const FEATURES = [
  {
    icon: <Box className="w-5 h-5" />,
    title: "Visual Scene Editor",
    desc: "Hierarchy panel, property inspector, transform gizmos, asset browser, drag-and-drop.",
    color: "#f6c945",
  },
  {
    icon: <Layers className="w-5 h-5" />,
    title: "Three.js + R3F",
    desc: "Full React Three Fiber pipeline with postprocessing — bloom, SSAO, DOF.",
    color: "#6aa9ff",
  },
  {
    icon: <Gamepad2 className="w-5 h-5" />,
    title: "Rapier 3D Physics",
    desc: "Rigid bodies, colliders, joints, raycasting — all configurable in-editor.",
    color: "#ff6b57",
  },
  {
    icon: <Wand2 className="w-5 h-5" />,
    title: "AI Assistant",
    desc: "Claude, Puter AI, Ollama (offline), Cloudflare Workers AI. 15-turn tool loop with cooldown.",
    color: "#a78bfa",
  },
  {
    icon: <Code2 className="w-5 h-5" />,
    title: "Monaco Code Editor",
    desc: "Embedded TypeScript editor for custom scripts, behaviors, and game logic.",
    color: "#6bdc8b",
  },
  {
    icon: <Palette className="w-5 h-5" />,
    title: "Asset Pipeline",
    desc: "FBX→GLB, OBJ→GLB, ZIP extract — all in-browser via WASM. Upload to R2 CDN.",
    color: "#ff8a3d",
  },
  {
    icon: <Shield className="w-5 h-5" />,
    title: "Navmesh & AI Pathfinding",
    desc: "Recast navmesh baking + Yuka AI behaviors. Enemy patrol, chase, line-of-sight.",
    color: "#21d4ff",
  },
  {
    icon: <MonitorPlay className="w-5 h-5" />,
    title: "Babylon.js Runtime",
    desc: "Engine-agnostic scene format. Design in Three.js, play in Babylon.js.",
    color: "#e879f9",
  },
];

const AI_PROVIDERS = [
  { name: "Claude Sonnet 4.6", hint: "Server · Default", color: "#ff8a3d" },
  { name: "Ollama (Local)", hint: "Offline · qwen2.5-coder", color: "#6bdc8b" },
  { name: "Puter AI", hint: "Free · 9 models", color: "#f6c945" },
  { name: "CF Workers AI", hint: "Image gen · Text · Vision", color: "#6aa9ff" },
];

const STATS = [
  { value: "100+", label: "Builtin 3D models" },
  { value: "15K", label: "Token response cap" },
  { value: "13", label: "AI models available" },
  { value: "7", label: "Scene templates" },
];

export function LandingPage() {
  const [, setLocation] = useLocation();
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    // Unlock document scroll — global CSS keeps body overflow:hidden for the editor.
    document.documentElement.classList.add("route-landing");
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.documentElement.classList.remove("route-landing");
    };
  }, []);

  return (
    <div
      className="min-h-screen text-[#e8ecf4] overflow-x-hidden"
      style={{ background: "#050608", fontFamily: FONTS.body }}
      data-landing
    >
      {/* ── Animated background ── */}
      <div className="fixed inset-0 pointer-events-none">
        <div
          className="absolute inset-0"
          style={{
            background: `
              radial-gradient(ellipse 1200px 600px at 30% 20%, rgba(246,201,69,0.06), transparent 60%),
              radial-gradient(ellipse 800px 500px at 70% 60%, rgba(106,169,255,0.04), transparent 50%),
              radial-gradient(ellipse 600px 400px at 50% 90%, rgba(167,139,250,0.05), transparent 50%)
            `,
          }}
        />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
            transform: `translateY(${scrollY * 0.05}px)`,
          }}
        />
      </div>

      {/* ── Nav ── */}
      <nav
        className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
        style={{
          background: scrollY > 50 ? "rgba(5,6,8,0.92)" : "transparent",
          backdropFilter: scrollY > 50 ? "blur(16px)" : "none",
          borderBottom: scrollY > 50 ? "1px solid rgba(255,255,255,0.04)" : "none",
        }}
      >
        <div className="max-w-6xl mx-auto px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-[#050608]" />
            </div>
            <span
              style={{ fontFamily: FONTS.display }}
              className="text-sm font-bold tracking-[3px] bg-gradient-to-r from-amber-400 via-amber-200 to-amber-400 bg-clip-text text-transparent"
            >
              GRUDGE FORGE
            </span>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="https://github.com/MolochDaGod/Grudge-Studio-Forge"
              target="_blank"
              rel="noopener"
              className="text-[11px] text-white/30 hover:text-white/60 transition-colors"
            >
              GitHub
            </a>
            <a
              href="https://grudge-studio.com"
              target="_blank"
              rel="noopener"
              className="text-[11px] text-white/30 hover:text-white/60 transition-colors"
            >
              Grudge Studio
            </a>
            <button
              onClick={() => setLocation("/editor")}
              className="text-[11px] font-semibold px-4 py-1.5 rounded-md transition-all hover:-translate-y-0.5"
              style={{
                background: "linear-gradient(180deg, #f6c945, #d8a819)",
                color: "#1a1400",
              }}
            >
              Launch Editor
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative pt-32 pb-20 px-6">
        <div className="max-w-5xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-amber-500/20 bg-amber-500/5 mb-6">
            <Zap className="w-3 h-3 text-amber-400" />
            <span className="text-[10px] text-amber-400/80 tracking-wider uppercase font-semibold">
              v0.1.0 · Offline AI · Asset Pipeline
            </span>
          </div>

          <h1
            style={{ fontFamily: FONTS.display }}
            className="text-5xl md:text-7xl font-black tracking-wide mb-4 leading-[1.1]"
          >
            <span className="bg-gradient-to-b from-white via-[#e8ecf4] to-[#8a93a8] bg-clip-text text-transparent">
              Build Games
            </span>
            <br />
            <span className="bg-gradient-to-r from-amber-400 via-amber-200 to-amber-400 bg-clip-text text-transparent">
              In Your Browser
            </span>
          </h1>

          <p className="text-white/40 text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
            Three.js scene editor with AI-assisted game building, Rapier 3D physics,
            and a full asset pipeline — runs online or{" "}
            <span className="text-white/60 font-medium">completely offline</span> with Ollama.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={() => setLocation("/editor")}
              className="group flex items-center gap-2 px-8 py-3.5 rounded-lg text-sm font-bold tracking-wider transition-all hover:-translate-y-1 hover:shadow-[0_20px_40px_-12px_rgba(246,201,69,0.4)]"
              style={{
                fontFamily: FONTS.display,
                background: "linear-gradient(180deg, #f6c945, #c89a15)",
                color: "#1a1400",
              }}
            >
              Open Editor
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </button>
            <a
              href="https://github.com/MolochDaGod/Grudge-Studio-Forge"
              target="_blank"
              rel="noopener"
              className="flex items-center gap-2 px-6 py-3 rounded-lg text-sm text-white/50 hover:text-white/80 border border-white/[0.06] hover:border-white/[0.15] transition-all hover:-translate-y-0.5"
              style={{ background: "rgba(255,255,255,0.02)" }}
            >
              <Download className="w-4 h-4" />
              Clone from GitHub
            </a>
          </div>
        </div>
      </section>

      {/* ── Stats bar ── */}
      <section className="relative py-6 border-y border-white/[0.04]" style={{ background: "rgba(255,255,255,0.01)" }}>
        <div className="max-w-5xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-6">
          {STATS.map((s) => (
            <div key={s.label} className="text-center">
              <div
                style={{ fontFamily: FONTS.mono }}
                className="text-2xl md:text-3xl font-bold text-amber-400/90 mb-0.5"
              >
                {s.value}
              </div>
              <div className="text-[10px] text-white/25 uppercase tracking-wider">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features grid ── */}
      <section className="relative py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <h2
            style={{ fontFamily: FONTS.display }}
            className="text-2xl md:text-3xl font-bold text-center mb-3 tracking-wide"
          >
            Everything You Need
          </h2>
          <p className="text-white/30 text-center text-sm mb-12 max-w-lg mx-auto">
            A complete game development environment — scene editing, physics, AI, scripting,
            asset management, and deployment.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group p-4 rounded-xl border border-white/[0.04] hover:border-white/[0.1] transition-all duration-300 hover:-translate-y-1"
                style={{ background: "linear-gradient(180deg, rgba(14,18,28,0.6), rgba(8,10,18,0.6))" }}
              >
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center mb-3 transition-colors"
                  style={{
                    background: `${f.color}10`,
                    border: `1px solid ${f.color}20`,
                    color: f.color,
                  }}
                >
                  {f.icon}
                </div>
                <h3 className="text-xs font-semibold text-white/80 mb-1">{f.title}</h3>
                <p className="text-[11px] text-white/30 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── AI Providers ── */}
      <section className="relative py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10">
            <h2
              style={{ fontFamily: FONTS.display }}
              className="text-2xl font-bold mb-2 tracking-wide"
            >
              AI That Works Anywhere
            </h2>
            <p className="text-white/30 text-sm">
              Online, offline, or hybrid — pick the model that fits your workflow.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {AI_PROVIDERS.map((p) => (
              <div
                key={p.name}
                className="flex items-center gap-3 p-4 rounded-xl border border-white/[0.04] hover:border-white/[0.1] transition-all"
                style={{ background: "rgba(14,18,28,0.5)" }}
              >
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: p.color, boxShadow: `0 0 8px ${p.color}60` }}
                />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white/70">{p.name}</div>
                  <div className="text-[10px] text-white/25">{p.hint}</div>
                </div>
                {p.name.includes("Ollama") && (
                  <WifiOff className="w-3.5 h-3.5 text-emerald-500/50 ml-auto flex-shrink-0" />
                )}
                {p.name.includes("Claude") && (
                  <Globe className="w-3.5 h-3.5 text-amber-500/40 ml-auto flex-shrink-0" />
                )}
              </div>
            ))}
          </div>

          <div className="mt-6 p-4 rounded-xl border border-emerald-500/10 bg-emerald-950/10">
            <div className="flex items-start gap-3">
              <WifiOff className="w-4 h-4 text-emerald-400/60 mt-0.5 flex-shrink-0" />
              <div>
                <div className="text-xs font-semibold text-emerald-300/70 mb-1">1-Click Offline Setup</div>
                <p className="text-[11px] text-white/30 leading-relaxed">
                  Run{" "}
                  <code
                    className="px-1.5 py-0.5 rounded bg-white/[0.04] text-emerald-300/60 text-[10px]"
                    style={{ fontFamily: FONTS.mono }}
                  >
                    pwsh -File scripts/setup-offline.ps1
                  </code>{" "}
                  — installs Ollama, pulls Qwen 2.5 Coder + Llama 3.2, starts the editor.
                  No internet required after setup.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Asset conversion ── */}
      <section
        className="relative py-16 px-6 border-y border-white/[0.04]"
        style={{ background: "rgba(255,255,255,0.008)" }}
      >
        <div className="max-w-4xl mx-auto">
          <h2
            style={{ fontFamily: FONTS.display }}
            className="text-2xl font-bold text-center mb-8 tracking-wide"
          >
            Drag. Drop. Done.
          </h2>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {["FBX → GLB", "OBJ → GLB", "STL → GLB", "ZIP → GLB[]", "PNG", "JPG", "WebP", "JSON"].map((f) => (
              <div
                key={f}
                className="text-center py-3 px-2 rounded-lg border border-white/[0.04]"
                style={{ background: "rgba(14,18,28,0.4)" }}
              >
                <div
                  className="text-[11px] font-bold text-white/50"
                  style={{ fontFamily: FONTS.mono }}
                >
                  {f}
                </div>
              </div>
            ))}
          </div>

          <p className="text-center text-[11px] text-white/20 mt-4">
            Browser-side conversion via assimpjs WASM · ZIP extraction via fflate · Direct R2 CDN upload
          </p>
        </div>
      </section>

      {/* ── Download & Access ── */}
      <section className="relative py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <h2
            style={{ fontFamily: FONTS.display }}
            className="text-2xl md:text-3xl font-bold text-center mb-3 tracking-wide"
          >
            Get Grudge Forge
          </h2>
          <p className="text-white/30 text-center text-sm mb-12 max-w-lg mx-auto">
            Choose your way in — browser, desktop, or source code.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Web Editor */}
            <div
              className="group p-6 rounded-xl border border-amber-500/15 hover:border-amber-500/30 transition-all duration-300 hover:-translate-y-1 text-center"
              style={{ background: "linear-gradient(180deg, rgba(246,201,69,0.04), rgba(8,10,18,0.6))" }}
            >
              <div className="w-12 h-12 mx-auto rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-4">
                <Globe className="w-6 h-6 text-amber-400" />
              </div>
              <h3 style={{ fontFamily: FONTS.display }} className="text-sm font-bold text-white/80 mb-1 tracking-wider">
                Web Editor
              </h3>
              <p className="text-[11px] text-white/30 mb-5 leading-relaxed">
                Launch instantly in your browser. No install. Sign in with Puter for cloud save.
              </p>
              <button
                onClick={() => setLocation("/editor")}
                className="inline-flex items-center gap-1.5 px-6 py-2.5 rounded-lg text-xs font-bold tracking-wider transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_24px_-8px_rgba(246,201,69,0.35)]"
                style={{
                  fontFamily: FONTS.display,
                  background: "linear-gradient(180deg, #f6c945, #c89a15)",
                  color: "#1a1400",
                }}
              >
                Open Editor
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Desktop App */}
            <div
              className="group p-6 rounded-xl border border-white/[0.06] hover:border-white/[0.15] transition-all duration-300 hover:-translate-y-1 text-center"
              style={{ background: "linear-gradient(180deg, rgba(14,18,28,0.6), rgba(8,10,18,0.6))" }}
            >
              <div className="w-12 h-12 mx-auto rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-4">
                <Download className="w-6 h-6 text-blue-400" />
              </div>
              <h3 style={{ fontFamily: FONTS.display }} className="text-sm font-bold text-white/80 mb-1 tracking-wider">
                Desktop App
              </h3>
              <p className="text-[11px] text-white/30 mb-5 leading-relaxed">
                Windows installer with Ollama offline AI, FBX import, glTF tools, and auto-updates.
              </p>
              <a
                href="https://github.com/MolochDaGod/Grudge-Studio-Forge/releases/latest"
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1.5 px-6 py-2.5 rounded-lg text-xs font-semibold border border-white/[0.1] hover:border-white/[0.2] text-white/60 hover:text-white/90 transition-all hover:-translate-y-0.5"
                style={{ background: "rgba(255,255,255,0.03)" }}
              >
                <Download className="w-3.5 h-3.5" />
                Download .exe
              </a>
              <div className="mt-2">
                <span className="text-[9px] text-white/15">Windows 10+ · v0.3.1</span>
              </div>
            </div>

            {/* Source Code */}
            <div
              className="group p-6 rounded-xl border border-white/[0.06] hover:border-white/[0.15] transition-all duration-300 hover:-translate-y-1 text-center"
              style={{ background: "linear-gradient(180deg, rgba(14,18,28,0.6), rgba(8,10,18,0.6))" }}
            >
              <div className="w-12 h-12 mx-auto rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-4">
                <Code2 className="w-6 h-6 text-emerald-400" />
              </div>
              <h3 style={{ fontFamily: FONTS.display }} className="text-sm font-bold text-white/80 mb-1 tracking-wider">
                Source Code
              </h3>
              <p className="text-[11px] text-white/30 mb-5 leading-relaxed">
                Clone the monorepo. Full pnpm workspace with 14 packages. MIT licensed.
              </p>
              <a
                href="https://github.com/MolochDaGod/Grudge-Studio-Forge"
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1.5 px-6 py-2.5 rounded-lg text-xs font-semibold border border-white/[0.1] hover:border-white/[0.2] text-white/60 hover:text-white/90 transition-all hover:-translate-y-0.5"
                style={{ background: "rgba(255,255,255,0.03)" }}
              >
                Clone from GitHub
              </a>
              <div className="mt-2">
                <code className="text-[9px] text-white/15" style={{ fontFamily: FONTS.mono }}>
                  pnpm install && pnpm run dev
                </code>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── System Requirements ── */}
      <section className="relative py-12 px-6 border-y border-white/[0.04]" style={{ background: "rgba(255,255,255,0.008)" }}>
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <h3 style={{ fontFamily: FONTS.display }} className="text-xs font-bold text-white/50 tracking-wider mb-3 uppercase">
                Web Editor
              </h3>
              <ul className="space-y-1.5 text-[11px] text-white/30">
                <li>• Chrome, Edge, or Firefox (latest)</li>
                <li>• WebGL 2.0 + WebAssembly support</li>
                <li>• 2 GB RAM minimum (4 GB recommended)</li>
                <li>• No install required</li>
              </ul>
            </div>
            <div>
              <h3 style={{ fontFamily: FONTS.display }} className="text-xs font-bold text-white/50 tracking-wider mb-3 uppercase">
                Desktop App
              </h3>
              <ul className="space-y-1.5 text-[11px] text-white/30">
                <li>• Windows 10 or later (64-bit)</li>
                <li>• 4 GB RAM (8 GB for offline AI)</li>
                <li>• ~500 MB disk (+ Ollama models)</li>
                <li>• GPU with DirectX 11+ recommended</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="relative py-20 px-6 text-center">
        <h2
          style={{ fontFamily: FONTS.display }}
          className="text-3xl md:text-4xl font-bold mb-3 tracking-wide"
        >
          Start Building
        </h2>
        <p className="text-white/30 text-sm mb-8 max-w-md mx-auto">
          Open the editor, pick a template, and build your first scene in under a minute.
        </p>
        <button
          onClick={() => setLocation("/editor")}
          className="group inline-flex items-center gap-2 px-10 py-4 rounded-lg text-sm font-bold tracking-wider transition-all hover:-translate-y-1 hover:shadow-[0_20px_40px_-12px_rgba(246,201,69,0.4)]"
          style={{
            fontFamily: FONTS.display,
            background: "linear-gradient(180deg, #f6c945, #c89a15)",
            color: "#1a1400",
          }}
        >
          Launch Grudge Forge
          <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
        </button>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-white/[0.04] py-8 px-6">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span style={{ fontFamily: FONTS.display }} className="text-[9px] text-white/15 tracking-[3px]">
              GRUDGE FORGE v0.1.0
            </span>
            <span className="text-[9px] text-white/10">·</span>
            <span className="text-[9px] text-white/10">© Grudge Studio</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="https://grudge-studio.com" className="text-[10px] text-white/20 hover:text-white/40 transition-colors">
              Platform
            </a>
            <a href="https://grudgewarlords.com" className="text-[10px] text-white/20 hover:text-white/40 transition-colors">
              Grudge Warlords
            </a>
            <a href="https://dash.grudge-studio.com" className="text-[10px] text-white/20 hover:text-white/40 transition-colors">
              Dashboard
            </a>
            <a
              href="https://github.com/MolochDaGod/Grudge-Studio-Forge"
              className="text-[10px] text-white/20 hover:text-white/40 transition-colors"
            >
              GitHub
            </a>
          </div>
        </div>
        <div className="text-center mt-4">
          <span className="text-[8px] text-white/8">
            Created by Racalvin The Pirate King
          </span>
        </div>
      </footer>
    </div>
  );
}
