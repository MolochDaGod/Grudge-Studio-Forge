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
      bus.on("hit", () => {
        setHitFlash(1);
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

      {/* Crosshair */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="relative h-6 w-6">
          {/* base crosshair */}
          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/70" />
          <div className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-white/70" />
          <div className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90" />
          {/* hit flash overlay */}
          <div
            className="absolute inset-0 transition-opacity"
            style={{ opacity: hitFlash }}
          >
            <div className="absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 bg-red-500" />
            <div className="absolute top-1/2 left-0 h-0.5 w-full -translate-y-1/2 bg-red-500" />
          </div>
        </div>
      </div>

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
