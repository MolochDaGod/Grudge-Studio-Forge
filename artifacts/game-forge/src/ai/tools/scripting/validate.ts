/**
 * Compile-check helpers for AI-authored scripts.
 *
 * These mirror the compile paths used by `PlayRuntime.getCompiledScript` so
 * "validate before save" produces the same accept/reject verdict the runtime
 * would. We deliberately do NOT run the compiled module — `start()` and
 * `update()` are only invoked once play mode begins, and a successful
 * compile is enough to prove the source is syntactically clean and exports
 * the expected hook shape.
 */

import { transpileCSharp } from "@/scene/csTranspile";

export type ScriptLanguage = "js" | "cs";

export interface ValidationError {
  message: string;
  /** Best-effort line number when the engine surfaces one. */
  line?: number;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
  /** Hooks the script exports — handy hint for the AI to confirm it
   *  actually wired up `start` / `update`. */
  exports: { start: boolean; update: boolean };
}

const HOOK_PROBE = `
try {
  const e = (typeof exports.start === "function");
  const u = (typeof exports.update === "function");
  return { __probe: true, start: e, update: u };
} catch (err) {
  return { __probe: true, start: false, update: false };
}
`;

function parseLineFromError(err: unknown): number | undefined {
  if (!(err instanceof Error)) return undefined;
  const m = /:(\d+):\d+/.exec(err.stack ?? "");
  if (m) return Number(m[1]);
  const m2 = /line (\d+)/i.exec(err.message);
  return m2 ? Number(m2[1]) : undefined;
}

function validateJs(source: string): ValidationResult {
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function(
      "exports",
      `"use strict"; const module = { exports }; ${source}\n${HOOK_PROBE}`,
    ) as (exports: Record<string, unknown>) => {
      __probe: true;
      start: boolean;
      update: boolean;
    };
    const probe = factory({});
    return {
      ok: true,
      errors: [],
      exports: { start: !!probe.start, update: !!probe.update },
    };
  } catch (err) {
    return {
      ok: false,
      errors: [
        {
          message: err instanceof Error ? err.message : String(err),
          line: parseLineFromError(err),
        },
      ],
      exports: { start: false, update: false },
    };
  }
}

function validateCs(source: string): ValidationResult {
  try {
    const js = transpileCSharp(source);
    // The transpiler always returns a closure that exposes start/update; we
    // peek at the source to report what it found rather than executing it.
    return {
      ok: true,
      errors: [],
      exports: {
        start: /\bfunction\s+start\s*\(/.test(js),
        update: /\bfunction\s+update\s*\(/.test(js),
      },
    };
  } catch (err) {
    return {
      ok: false,
      errors: [
        {
          message: err instanceof Error ? err.message : String(err),
        },
      ],
      exports: { start: false, update: false },
    };
  }
}

export function validateScript(
  language: ScriptLanguage,
  source: string,
): ValidationResult {
  return language === "cs" ? validateCs(source) : validateJs(source);
}
