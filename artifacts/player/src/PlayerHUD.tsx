import * as React from "react";
import { useEffect, useState } from "react";
import { getPlaySession } from "@/scene/playSession";

/**
 * Minimal DOM overlay for the standalone published player.
 *
 * Mirrors the RPG-style permanent-death panel from the editor's
 * `PlayHUD` (artifacts/game-forge/src/editor/PlayHUD.tsx): when a
 * behavior emits `playerDied { noRespawn:true }` on the shared
 * GameBus, we show a quiet "You died" panel with a Restart button.
 *
 * Restart in the player simply reloads the page — there is no
 * play/stop toggle here, but a full reload re-runs the same
 * scene.json + scripts.json bootstrap and remounts the runtime
 * with a fresh session, which is the equivalent of the editor's
 * play-stop / play-start cycle for visitors.
 *
 * The deathmatch respawn flow is intentionally NOT mirrored here:
 * it relies on `playerRespawning` countdowns and a "Stop play mode
 * to restart" instruction that does not apply to a published page.
 */
export function PlayerHUD(): React.ReactElement | null {
  const [permaDead, setPermaDead] = useState(false);

  useEffect(() => {
    const bus = getPlaySession().bus;
    const off = bus.on("playerDied", (p) => {
      const obj = p as { noRespawn?: boolean } | undefined;
      if (obj?.noRespawn) setPermaDead(true);
    });
    return () => {
      off();
    };
  }, []);

  if (!permaDead) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 30,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.6)",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        userSelect: "none",
      }}
    >
      <div
        style={{
          borderRadius: 6,
          border: "1px solid rgba(255,255,255,0.15)",
          background: "rgba(0,0,0,0.7)",
          padding: "24px 32px",
          textAlign: "center",
          boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
          backdropFilter: "blur(6px)",
        }}
      >
        <div
          style={{
            fontSize: 30,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.2em",
            color: "#f87171",
          }}
        >
          You died
        </div>
        <button
          type="button"
          onClick={() => {
            window.location.reload();
          }}
          style={{
            marginTop: 20,
            border: "1px solid rgba(255,255,255,0.25)",
            background: "rgba(255,255,255,0.1)",
            padding: "8px 16px",
            fontSize: 12,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.2em",
            color: "white",
            cursor: "pointer",
            borderRadius: 4,
          }}
          data-testid="rpg-death-restart"
        >
          Restart scene
        </button>
      </div>
    </div>
  );
}
