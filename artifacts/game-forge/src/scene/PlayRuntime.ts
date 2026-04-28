import { compileCSharp, type CompiledScript, type ScriptEntity, type ScriptContext } from "./csTranspile";
import type { Script } from "@workspace/api-client-react";

export type Compiled = CompiledScript & { error?: string };

const cache = new Map<string, Compiled>();

function compileJs(code: string): Compiled {
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function(
      "exports",
      `"use strict"; const module = { exports }; ${code}\nreturn module.exports;`,
    ) as (exports: Record<string, unknown>) => Record<string, unknown>;
    const exportsObj: Record<string, unknown> = {};
    const mod = factory(exportsObj);
    return {
      start: typeof mod.start === "function" ? (mod.start as Compiled["start"]) : undefined,
      update: typeof mod.update === "function" ? (mod.update as Compiled["update"]) : undefined,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function compileCs(code: string): Compiled {
  try {
    return compileCSharp(code);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export function getCompiledScript(script: Script): Compiled {
  const key = `${script.id}:${script.language}:${script.code.length}:${script.code.slice(0, 32)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const compiled = script.language === "cs" ? compileCs(script.code) : compileJs(script.code);
  cache.set(key, compiled);
  // bound cache
  if (cache.size > 64) cache.delete(cache.keys().next().value!);
  return compiled;
}

export function makeContext(opts: {
  delta: number;
  elapsed: number;
  keys: Record<string, boolean>;
  log: (level: "log" | "warn" | "error", msg: string) => void;
  findEntity: (name: string) => ScriptEntity | undefined;
}): ScriptContext {
  return {
    time: { delta: opts.delta, elapsed: opts.elapsed },
    input: { keys: opts.keys },
    scene: { find: opts.findEntity },
    log: (...args: unknown[]) => opts.log("log", args.map((a) => stringify(a)).join(" ")),
  };
}

function stringify(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
