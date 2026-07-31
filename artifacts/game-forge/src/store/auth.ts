import { create } from "zustand";

/**
 * Editor-side auth store — Puter + Grudge ID.
 *
 * Three terminal statuses (after the bootstrap completes):
 *   - "anon"     — bootstrap finished, no user, Welcome modal should be shown.
 *   - "guest"    — user explicitly chose "Continue without signing in".
 *                  Editor works locally; cloud / publish disabled with tooltip.
 *   - "signedIn" — real account via Puter and/or Grudge ID (id.grudge-studio.com).
 *                  `user.puter` is present only for Puter sessions.
 *                  `isPuterSignedIn` is true only when `user.puter` exists so
 *                  Cloud Save / Puter AI stay gated correctly.
 *
 * The `user.id` / `user.name` aliases are preserved so existing consumers
 * (UserMenu, screenshot tagging) keep working without per-call shape checks.
 */
export type AuthStatus = "idle" | "anon" | "guest" | "signedIn";

export interface PuterIdentity {
  uuid: string;
  username: string;
  email: string | null;
  /** True when Puter created a temporary account (the user clicked
   *  "Sign in with Puter" but never claimed the identity). The UI
   *  surfaces a "Claim your account" chip in this state. */
  isTemp: boolean;
}

export interface AuthUser {
  /** Stable id — Puter UUID for signed-in users, locally generated UUID
   *  for guests. Persisted across reloads. */
  id: string;
  /** Display name shown in the toolbar. */
  name: string;
  /** Present iff signed in via Puter. */
  puter?: PuterIdentity;
}

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  /** Convenience flag: real Puter session available — Cloud Save / Publish
   *  / Puter AI provider may be used. Guests get `false` here. */
  isPuterSignedIn: boolean;
  setUser(user: AuthUser | null): void;
  setSignedIn(user: AuthUser): void;
  setGuest(user: AuthUser): void;
  reset(): void;
}

export const useAuth = create<AuthState>((set) => ({
  status: "idle",
  user: null,
  isPuterSignedIn: false,
  setUser: (user) =>
    set({
      status: user ? (user.puter ? "signedIn" : "guest") : "anon",
      user,
      isPuterSignedIn: !!user?.puter,
    }),
  setSignedIn: (user) =>
    set({
      status: "signedIn",
      user,
      // Grudge ID SSO may call setSignedIn without a Puter identity — never
      // fake isPuterSignedIn or Cloud Save / Puter AI will hit guest errors.
      isPuterSignedIn: !!user?.puter,
    }),
  setGuest: (user) =>
    set({ status: "guest", user, isPuterSignedIn: false }),
  reset: () => set({ status: "anon", user: null, isPuterSignedIn: false }),
}));
