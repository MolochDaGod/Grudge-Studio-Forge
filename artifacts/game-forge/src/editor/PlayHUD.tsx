import { useEffect, useState } from "react";
import { useEditor } from "@/store/editor";
import type { GameBus } from "@/scene/GameBus";

/**
 * Deathmatch HUD overlay (DOM, positioned over the canvas).
 *
 *   • Crosshair (always visible during play)
 *   • Player health bar + numeric value (top-left)
 *   • Score: player vs enemies (top-center) — first to scoreLimit wins
 *   • Damage flash: brief red vignette when the player takes damage
 *   • Hit indicator: short white crosshair flash when the player hits an enemy
 *   • Respawn countdown overlay: "You died — respawning in Ns"
 *   • Win / Lose banner
 *
 * Subscribes to the {@link GameBus} for the play session passed in via prop.
 * The bus is owned by `ScriptedEntities`; PlayHUD never creates or resets it.
 */
export function PlayHUD({ bus }: { bus: GameBus }) {
  const env = useEditor((s) => s.sceneData.environment);
  const scoreLimit = env.scoreLimit ?? 10;

  const [playerHealth, setPlayerHealth] = useState(100);
  const [playerMaxHealth, setPlayerMaxHealth] = useState(100);
  const [playerScore, setPlayerScore] = useState(0);
  const [enemyScore, setEnemyScore] = useState(0);

  // Damage flash — opacity decays to 0 over 0.4s.
  const [damageFlash, setDamageFlash] = useState(0);
  // Hit indicator — opacity decays to 0 over 0.18s.
  const [hitFlash, setHitFlash] = useState(0);
  // Headshot indicator — short gold flash when player lands a headshot.
  const [headshotFlash, setHeadshotFlash] = useState(0);
  // Kill feed (most recent first, capped at 4). Each entry shows who killed
  // whom and how recently (auto-fades after FEED_TTL_MS).
  const [killFeed, setKillFeed] = useState<
    Array<{ id: number; text: string; mine: boolean; ts: number }>
  >([]);

  const [respawning, setRespawning] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<"win" | "lose" | null>(null);

  useEffect(() => {
    const offs: Array<() => void> = [];

    offs.push(
      bus.on("playerHealth", (p) => {
        const obj = p as { health?: number; max?: number } | undefined;
        if (typeof obj?.health === "number") setPlayerHealth(obj.health);
        if (typeof obj?.max === "number") setPlayerMaxHealth(obj.max);
      }),
    );
    offs.push(
      bus.on("damage", (p) => {
        const obj = p as { health?: number } | undefined;
        if (typeof obj?.health === "number") setPlayerHealth(obj.health);
        setDamageFlash(1);
      }),
    );
    offs.push(
      bus.on("hit", (p) => {
        const obj = p as { headshot?: boolean } | undefined;
        setHitFlash(1);
        if (obj?.headshot) setHeadshotFlash(1);
      }),
    );
    offs.push(
      bus.on("kill", (p) => {
        const obj = p as
          | { killerId?: string; victimId?: string; victimIsPlayer?: boolean }
          | undefined;
        if (!obj) return;
        const mine = !!obj.killerId && !obj.victimIsPlayer;
        const text = obj.victimIsPlayer
          ? "Enemy killed You"
          : mine
            ? "You killed Enemy"
            : "Enemy killed Enemy";
        setKillFeed((f) => {
          const next = [
            { id: Date.now() + Math.random(), text, mine, ts: Date.now() },
            ...f,
          ].slice(0, 4);
          return next;
        });
      }),
    );
    offs.push(
      bus.on("playerScore", (p) => {
        const obj = p as { score?: number } | undefined;
        if (typeof obj?.score === "number") setPlayerScore(obj.score);
      }),
    );
    offs.push(
      bus.on("enemyScore", (p) => {
        const obj = p as { score?: number } | undefined;
        if (typeof obj?.score === "number") setEnemyScore(obj.score);
      }),
    );
    offs.push(
      bus.on("playerRespawning", (p) => {
        const obj = p as { secondsLeft?: number } | undefined;
        setRespawning(typeof obj?.secondsLeft === "number" ? obj.secondsLeft : null);
      }),
    );
    offs.push(
      bus.on("playerRespawn", () => {
        setRespawning(null);
      }),
    );
    offs.push(bus.on("win", () => setOutcome("win")));
    offs.push(bus.on("lose", () => setOutcome("lose")));

    return () => {
      for (const off of offs) off();
    };
  }, [bus]);

  // Decay flashes each frame.
  useEffect(() => {
    if (damageFlash <= 0) return;
    const id = window.setTimeout(() => setDamageFlash((f) => Math.max(0, f - 0.12)), 40);
    return () => window.clearTimeout(id);
  }, [damageFlash]);
  useEffect(() => {
    if (hitFlash <= 0) return;
    const id = window.setTimeout(() => setHitFlash((f) => Math.max(0, f - 0.18)), 30);
    return () => window.clearTimeout(id);
  }, [hitFlash]);
  useEffect(() => {
    if (headshotFlash <= 0) return;
    const id = window.setTimeout(() => setHeadshotFlash((f) => Math.max(0, f - 0.06)), 50);
    return () => window.clearTimeout(id);
  }, [headshotFlash]);

  // Kill-feed entries auto-prune after 4s.
  const FEED_TTL_MS = 4000;
  useEffect(() => {
    if (killFeed.length === 0) return;
    const id = window.setInterval(() => {
      const now = Date.now();
      setKillFeed((f) => f.filter((e) => now - e.ts < FEED_TTL_MS));
    }, 500);
    return () => window.clearInterval(id);
  }, [killFeed.length]);

  const healthPct = Math.max(0, Math.min(1, playerHealth / Math.max(1, playerMaxHealth)));

  return (
    <div className="pointer-events-none absolute inset-0 z-30 select-none font-mono">
      {/* Damage flash vignette */}
      <div
        className="absolute inset-0 transition-opacity"
        style={{
          opacity: damageFlash,
          background: "radial-gradient(ellipse at center, transparent 30%, rgba(220,40,40,0.6) 100%)",
        }}
      />

      {/* Aim crosshair (dive-style: white ring → red when aiming, pulse on shoot,
          scales out + fades when hidden during respawn/win/lose). */}
      <DiveAim
        bus={bus}
        hidden={respawning !== null || outcome !== null}
        hitFlash={hitFlash}
      />
      <style>{`
        @keyframes diveAimShoot {
          0% { transform: scale(1); }
          50% { transform: scale(1.6); }
          100% { transform: scale(1); }
        }
        .dive-aim-shoot { animation: diveAimShoot 150ms ease-out; }
      `}</style>

      {/* Health bar — top left */}
      <div className="absolute left-4 top-4 w-56 rounded bg-black/55 px-3 py-2 text-white shadow">
        <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-white/70">
          <span>Health</span>
          <span>
            {playerHealth} / {playerMaxHealth}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded bg-white/15">
          <div
            className="h-full transition-all"
            style={{
              width: `${healthPct * 100}%`,
              background: healthPct > 0.5 ? "#34d399" : healthPct > 0.2 ? "#fbbf24" : "#ef4444",
            }}
          />
        </div>
      </div>

      {/* Kill feed — top right (newest first, fades out) */}
      <div className="absolute right-4 top-4 flex w-64 flex-col gap-1">
        {killFeed.map((entry, i) => {
          const age = Math.min(1, (Date.now() - entry.ts) / FEED_TTL_MS);
          const opacity = i === 0 ? 1 : Math.max(0.2, 1 - age);
          return (
            <div
              key={entry.id}
              className="rounded bg-black/55 px-2 py-1 text-right text-[11px] text-white shadow"
              style={{ opacity }}
            >
              <span className={entry.mine ? "text-emerald-300" : "text-red-300"}>
                {entry.text}
              </span>
            </div>
          );
        })}
      </div>

      {/* Headshot call-out — center, gold flash */}
      {headshotFlash > 0 && (
        <div
          className="absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2 transition-opacity"
          style={{ opacity: headshotFlash }}
        >
          <div className="rounded border border-yellow-300/80 bg-black/60 px-3 py-1 text-sm font-bold uppercase tracking-widest text-yellow-300 shadow">
            Headshot!
          </div>
        </div>
      )}

      {/* Scoreboard — top center */}
      <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded bg-black/55 px-4 py-2 text-white shadow">
        <div className="mb-1 text-center text-[10px] uppercase tracking-widest text-white/70">
          Deathmatch — first to {scoreLimit}
        </div>
        <div className="flex items-baseline gap-3 text-center">
          <div>
            <div className="text-[9px] uppercase text-emerald-300">You</div>
            <div className="text-2xl font-bold tabular-nums text-emerald-300">{playerScore}</div>
          </div>
          <div className="text-white/40">vs</div>
          <div>
            <div className="text-[9px] uppercase text-red-300">Enemies</div>
            <div className="text-2xl font-bold tabular-nums text-red-300">{enemyScore}</div>
          </div>
        </div>
      </div>

      {/* Respawn overlay */}
      {respawning !== null && !outcome && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/55">
          <div className="text-center">
            <div className="text-3xl font-bold uppercase tracking-widest text-red-400">
              You died
            </div>
            <div className="mt-2 text-lg text-white/80">Respawning in {respawning}s…</div>
          </div>
        </div>
      )}

      {/* Win / Lose banner */}
      {outcome && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70">
          <div className="text-center">
            <div
              className={
                "text-6xl font-black uppercase tracking-widest " +
                (outcome === "win" ? "text-emerald-300" : "text-red-400")
              }
            >
              {outcome === "win" ? "Victory" : "Defeated"}
            </div>
            <div className="mt-3 text-base text-white/70">
              Final score — You {playerScore} : Enemies {enemyScore}
            </div>
            <div className="mt-6 text-xs uppercase tracking-widest text-white/50">
              Stop play mode to restart
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Dive-style aim reticle. A 16-px white circle centered on the screen.
 *
 *   • Pulses (scale 1 → 1.6 → 1 over 150ms) on every `playerShot` event.
 *   • Turns red while RMB is held (subscribes to `weaponAim`, emitted by
 *     the player-deathmatch script).
 *   • Briefly recolors red on `hit` events too — feedback when a shot lands.
 *   • Scales to 1.5 + fades to 0 when `hidden` is true (respawn / win / lose).
 *
 * Style approximates the dive Aim.svelte component (border-radius: 50%,
 * 2px border, ease-in/out transitions on transform + opacity).
 */
function DiveAim({
  bus,
  hidden,
  hitFlash,
}: {
  bus: GameBus;
  hidden: boolean;
  hitFlash: number;
}) {
  const [aiming, setAiming] = useState(false);
  const [shootKey, setShootKey] = useState(0);

  useEffect(() => {
    const offs: Array<() => void> = [];
    offs.push(
      bus.on("weaponAim", (p) => {
        const obj = p as { aiming?: boolean } | boolean | undefined;
        const v = typeof obj === "boolean" ? obj : !!obj?.aiming;
        setAiming(v);
      }),
    );
    offs.push(
      bus.on("playerShot", () => {
        // Bumping a numeric key replays the CSS keyframe via React remount of
        // the className. We cycle modulo to avoid unbounded growth.
        setShootKey((k) => (k + 1) % 1_000_000);
      }),
    );
    return () => {
      for (const off of offs) off();
    };
  }, [bus]);

  // Border color: red when aiming OR briefly when a shot lands.
  const isRed = aiming || hitFlash > 0;
  const borderColor = isRed ? "rgb(239,68,68)" : "rgba(255,255,255,0.92)";
  const transform = hidden ? "scale(1.5)" : "scale(1)";
  const opacity = hidden ? 0 : 1;
  const transitionTiming = hidden ? "ease-in" : "ease-out";

  return (
    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
      <div className="relative" style={{ width: 16, height: 16 }}>
        <div
          // Re-keying restarts the CSS animation cleanly on every shot.
          key={shootKey}
          className={shootKey > 0 ? "dive-aim-shoot" : undefined}
          style={{
            position: "absolute",
            inset: 0,
            border: `2px solid ${borderColor}`,
            borderRadius: "50%",
            opacity,
            transform,
            transitionProperty: "transform, opacity, border-color",
            transitionDuration: "250ms",
            transitionTimingFunction: transitionTiming,
            transformOrigin: "center center",
          }}
        />
        {/* Center dot — small precision aid, hidden when the ring is hidden. */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: 2,
            height: 2,
            marginLeft: -1,
            marginTop: -1,
            borderRadius: "50%",
            background: borderColor,
            opacity: opacity * 0.9,
            transition: "opacity 250ms, background 250ms",
          }}
        />
      </div>
    </div>
  );
}
