import { create } from "zustand";
import type { GrudgeUser } from "@workspace/api-client-react";

/**
 * Editor-side auth store.
 *
 * Source of truth for "who is signed in?" across the editor UI. Forge is
 * intentionally session-less on the server — Puter Auth lives entirely
 * client-side via the Puter SDK, which manages its own token storage.
 * `bootstrapAuth()` asks the SDK whether a user is signed in, and only
 * if so does it call `/api/auth/puter/sync` once to mirror the user
 * into the shared `users` table and resolve the canonical Grudge ID.
 *
 * We deliberately avoid persisting anything to localStorage ourselves:
 * the SDK already handles that, and asking it on every boot keeps the
 * client view consistent with reality (e.g. after the user signed out
 * from the upstream Grudge dashboard or another tab).
 */
export type AuthStatus =
  | "idle"      // boot — haven't asked the SDK yet
  | "loading"   // a sign-in or sync is in flight
  | "anon"      // SDK reports no signed-in Puter user (guest mode)
  | "signedIn"  // SDK reports a user and the server sync succeeded
  | "error";    // last operation failed; surface via `error`

interface AuthState {
  status: AuthStatus;
  user: GrudgeUser | null;
  error: string | null;
  /** Server-confirmed feature flags from /auth/config. */
  config: {
    puterSiteOrigin: string;
    puterBasePath: string;
    enablePuterCloud: boolean;
    grudgeAuthUrl: string | null;
  } | null;

  setLoading(): void;
  setUser(user: GrudgeUser | null): void;
  setError(message: string): void;
  setConfig(config: AuthState["config"]): void;
}

export const useAuth = create<AuthState>((set) => ({
  status: "idle",
  user: null,
  error: null,
  config: null,

  setLoading: () => set({ status: "loading", error: null }),
  setUser: (user) =>
    set({
      status: user ? "signedIn" : "anon",
      user,
      error: null,
    }),
  setError: (message) => set({ status: "error", error: message }),
  setConfig: (config) => set({ config }),
}));
