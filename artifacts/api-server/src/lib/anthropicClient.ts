/**
 * Pre-configured Anthropic SDK client.
 *
 * Supports two env var patterns:
 *   1. Replit AI Integrations (auto-provisioned):
 *        AI_INTEGRATIONS_ANTHROPIC_BASE_URL + AI_INTEGRATIONS_ANTHROPIC_API_KEY
 *   2. Direct Anthropic key (Railway / VPS / local):
 *        ANTHROPIC_API_KEY  (baseURL defaults to Anthropic's public endpoint)
 *
 * When neither is set the export is `null` and the AI route falls back
 * to the Puter provider or returns a clear 503. This lets the server
 * boot without an AI key — projects, scenes, storage, etc. all work. */
import Anthropic from "@anthropic-ai/sdk";

const replitBase = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
const replitKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
const directKey = process.env.ANTHROPIC_API_KEY;

const baseURL = replitBase || undefined;          // undefined → SDK default
const apiKey = replitKey || directKey || undefined;

export const anthropic: Anthropic | null =
  apiKey ? new Anthropic({ ...(baseURL ? { baseURL } : {}), apiKey }) : null;
