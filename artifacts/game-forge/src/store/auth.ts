import { create } from "zustand";

/**
 * Editor-side auth store — Puter-backed.
 *
 * Three terminal statuses (after the bootstrap completes):
 *   - "anon"     — bootstrap finished, no user, Welcome modal should be shown.
 *   - "guest"    — user explicitly chose "Continue without signing in".
 *                  Editor works locally; cloud / publish disabled with tooltip.
 *   - "signedIn" — `puter.auth.isSignedIn()` returned true. `user.puter` is
 *                  the authoritative identity (uuid + username, optionally
 *                  email + isTemp). The Toolbar's existing
 *                  `status === "signedIn"` publish gate naturally lights up
 *                  only for the real Puter session.
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
    set({ status: "signedIn", user, isPuterSignedIn: true }),
  setGuest: (user) =>
    set({ status: "guest", user, isPuterSignedIn: false }),
  reset: () => set({ status: "anon", user: null, isPuterSignedIn: false }),
}));
