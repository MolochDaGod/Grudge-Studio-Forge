/**
 * Pre-configured Anthropic SDK client.
 *
 * Supports two env var patterns:
 *   1. Custom proxy (e.g. AI gateway):
 *        ANTHROPIC_BASE_URL + ANTHROPIC_API_KEY
 *   2. Direct Anthropic key (VPS / local):
 *        ANTHROPIC_API_KEY  (baseURL defaults to Anthropic's public endpoint)
 *
 * When neither is set the export is `null` and the AI route falls back
 * to the Puter provider or returns a clear 503. This lets the server
 * boot without an AI key — projects, scenes, storage, etc. all work. */
import Anthropic from "@anthropic-ai/sdk";

const customBase = process.env.ANTHROPIC_BASE_URL;
const rawKey = (process.env.ANTHROPIC_API_KEY || "").trim();

/** Reject empty / placeholder keys so we fall through to Puter instead of 401 spam. */
function isUsableAnthropicKey(key: string): boolean {
  if (!key || key.length < 20) return false;
  const lower = key.toLowerCase();
  if (
    lower.includes("change_me") ||
    lower.includes("your_key") ||
    lower.includes("placeholder") ||
    lower === "sk-ant-api03-invalid" ||
    lower.startsWith("sk-ant-xxx")
  ) {
    return false;
  }
  return true;
}

const apiKey = isUsableAnthropicKey(rawKey) ? rawKey : undefined;
const baseURL = customBase || undefined;

export const anthropic: Anthropic | null =
  apiKey ? new Anthropic({ ...(baseURL ? { baseURL } : {}), apiKey }) : null;

/** Human-readable fix when Anthropic is unavailable. */
export const ANTHROPIC_UNAVAILABLE_HINT =
  "Server Anthropic is not configured (or the API key is invalid). " +
  "In the AI Worker model picker choose a Puter model and Sign in with Puter, " +
  "or run Ollama locally (http://localhost:11434) and pick a local model.";
