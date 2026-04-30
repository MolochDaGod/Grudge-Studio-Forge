import { create } from "zustand";
import type { GrudgeUser } from "@workspace/api-client-react";

/**
 * Editor-side auth store.
 *
 * Source of truth for "who is signed in?" across the editor UI. The
 * store is rehydrated on app boot by `bootstrapAuth()` calling
 * `/api/auth/me`, then mutated by the sign-in/out flows. We deliberately
 * avoid persisting any of this to localStorage — the cookie is the
 * persistent credential, and re-reading `/auth/me` on boot keeps the
 * client view consistent with the server (e.g. after the user signed
 * out from the upstream Grudge dashboard).
 */
export type AuthStatus =
  | "idle"      // boot — never queried the server yet
  | "loading"   // a sign-in or rehydrate is in flight
  | "anon"      // server confirmed the user is anonymous
  | "signedIn"  // server returned a valid GrudgeUser
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
