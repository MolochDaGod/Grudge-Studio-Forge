import { create } from "zustand";

/**
 * In-flight collider-bake progress store.
 *
 * Convex-decomp bakes are dispatched to a worker pool (see
 * `lib/colliderBaker.ts`) and can take several seconds for big GLBs.
 * The editor stays interactive while they run, but with no visible
 * signal that anything is happening. This store tracks one entry per
 * entity bake — start time, status, accumulated worker warnings — so
 * `BakeProgressToasts` can render a per-bake toast/badge until the
 * bake completes (and for a short grace window after success/error so
 * the user actually sees the outcome).
 */

export type BakeProgressStatus = "running" | "ok" | "error";

export interface BakeProgressWarning {
  message: string;
  detail?: string;
}

export interface BakeProgressEntry {
  /** Stable id for this bake invocation — entityId is fine since the
   *  helper guards against double-bake of the same entity by replacing
   *  the entry. Using entityId also lets us look it up cheaply. */
  entityId: string;
  /** Human-readable label shown in the toast. Falls back to entity id. */
  entityName: string;
  startedAt: number;
  status: BakeProgressStatus;
  warnings: BakeProgressWarning[];
  /** Set when status flips to ok/error so the UI can drive elapsed
   *  time off it instead of `Date.now()` after completion. */
  completedAt?: number;
  /** One-line summary shown when status is `ok` or `error`. */
  summary?: string;
}

interface BakeProgressState {
  entries: BakeProgressEntry[];
  begin: (entityId: string, entityName: string) => void;
  warn: (entityId: string, message: string, detail?: string) => void;
  finish: (
    entityId: string,
    status: "ok" | "error",
    summary: string,
  ) => void;
  remove: (entityId: string) => void;
}

export const useBakeProgress = create<BakeProgressState>((set) => ({
  entries: [],
  begin: (entityId, entityName) =>
    set((s) => {
      const others = s.entries.filter((e) => e.entityId !== entityId);
      return {
        entries: [
          ...others,
          {
            entityId,
            entityName,
            startedAt: Date.now(),
            status: "running",
            warnings: [],
          },
        ],
      };
    }),
  warn: (entityId, message, detail) =>
    set((s) => ({
      entries: s.entries.map((e) =>
        e.entityId === entityId
          ? { ...e, warnings: [...e.warnings, { message, detail }] }
          : e,
      ),
    })),
  finish: (entityId, status, summary) =>
    set((s) => ({
      entries: s.entries.map((e) =>
        e.entityId === entityId
          ? { ...e, status, summary, completedAt: Date.now() }
          : e,
      ),
    })),
  remove: (entityId) =>
    set((s) => ({ entries: s.entries.filter((e) => e.entityId !== entityId) })),
}));
