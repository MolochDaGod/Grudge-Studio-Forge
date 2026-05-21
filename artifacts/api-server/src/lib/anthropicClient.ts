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
const apiKey = process.env.ANTHROPIC_API_KEY || undefined;

const baseURL = customBase || undefined;

export const anthropic: Anthropic | null =
  apiKey ? new Anthropic({ ...(baseURL ? { baseURL } : {}), apiKey }) : null;
