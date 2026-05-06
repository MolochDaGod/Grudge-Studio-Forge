/**
 * `?` (Shift+/) cheatsheet overlay.
 *
 * Listens for a `gameforge:toggleHotkeyCheatsheet` window event and toggles
 * its open state. Esc closes. The hotkey list is harvested from
 * `buildEditorHotkeys` so this overlay always reflects the live registry —
 * no separate copy of the bindings to keep in sync.
 */

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { buildEditorHotkeys } from "@/lib/editorHotkeys";
import type { Hotkey, HotkeyCategory } from "@/lib/hotkeys";

const CATEGORY_ORDER: HotkeyCategory[] = [
  "Gizmo",
  "Camera",
  "Selection",
  "Edit",
  "Scene",
  "Playback",
  "View",
  "Misc",
];

function formatLabel(h: Hotkey): string {
  if (h.label) return h.label;
  const parts: string[] = [];
  if (h.ctrlOrMeta) parts.push("Ctrl");
  if (h.shift) parts.push("Shift");
  parts.push(h.key.length === 1 ? h.key.toUpperCase() : h.key);
  return parts.join("+");
}

export function HotkeyCheatsheet() {
  const [open, setOpen] = useState(false);

  // Build the descriptor list once — the cheatsheet doesn't dispatch
  // any actions, so the toggle dep is a no-op.
  const hotkeys = useMemo(
    () => buildEditorHotkeys({ toggleCheatsheet: () => {} }),
    [],
  );

  useEffect(() => {
    const onToggle = () => setOpen((v) => !v);
    window.addEventListener("gameforge:toggleHotkeyCheatsheet", onToggle);
    return () =>
      window.removeEventListener("gameforge:toggleHotkeyCheatsheet", onToggle);
  }, []);

  // Esc closes — bound at capture phase so it wins over panels that may
  // also handle Escape. We only intercept when actually open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [open]);

  const groups = useMemo(() => {
    const m = new Map<HotkeyCategory, Hotkey[]>();
    for (const h of hotkeys) {
      const cat = (h.category ?? "Misc") as HotkeyCategory;
      const arr = m.get(cat) ?? [];
      arr.push(h);
      m.set(cat, arr);
    }
    return CATEGORY_ORDER.filter((c) => m.has(c)).map((c) => ({
      category: c,
      items: m.get(c)!,
    }));
  }, [hotkeys]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-background/70 backdrop-blur-sm"
      data-testid="hotkey-cheatsheet"
      onClick={(e) => {
        // Click outside the panel closes the overlay.
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="relative max-w-3xl w-[min(720px,92vw)] max-h-[80vh] overflow-y-auto rounded-xl border border-card-border bg-card shadow-2xl p-6">
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close shortcuts"
          className="absolute top-3 right-3 w-8 h-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/10 border border-transparent hover:border-card-border transition-colors"
          data-testid="hotkey-cheatsheet-close"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="text-[11px] font-heading uppercase tracking-[0.18em] text-accent mb-1">
          Reference
        </div>
        <h2 className="text-lg font-heading mb-1 pr-7">Keyboard shortcuts</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Press <span className="font-mono">?</span> any time to open this
          panel · <span className="font-mono">Esc</span> to close.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
          {groups.map((g) => (
            <section key={g.category} data-testid={`hotkey-group-${g.category}`}>
              <div className="text-[10px] font-heading uppercase tracking-[0.18em] text-muted-foreground mb-2">
                {g.category}
              </div>
              <ul className="space-y-1.5">
                {g.items.map((h) => (
                  <li
                    key={h.id}
                    className="flex items-start justify-between gap-3 text-xs"
                  >
                    <span className="text-foreground/90 leading-snug">
                      {h.description}
                    </span>
                    <kbd className="shrink-0 font-mono text-[10px] px-1.5 py-0.5 rounded border border-card-border bg-background text-foreground/80">
                      {formatLabel(h)}
                    </kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
