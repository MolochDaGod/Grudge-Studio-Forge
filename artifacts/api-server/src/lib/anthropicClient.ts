/**
 * Pre-configured Anthropic SDK client. Uses Replit AI Integrations env vars
 * (no own API key required). The integration auto-provisions both:
 *   AI_INTEGRATIONS_ANTHROPIC_BASE_URL
 *   AI_INTEGRATIONS_ANTHROPIC_API_KEY
 *
 * The API key value itself is a sandbox proxy token — do not log it. */
import Anthropic from "@anthropic-ai/sdk";

const baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;

if (!baseURL || !apiKey) {
  throw new Error(
    "Anthropic AI integration not configured: missing " +
      "AI_INTEGRATIONS_ANTHROPIC_BASE_URL or AI_INTEGRATIONS_ANTHROPIC_API_KEY",
  );
}

export const anthropic = new Anthropic({ baseURL, apiKey });
