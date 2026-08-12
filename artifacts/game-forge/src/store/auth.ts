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
  /** Stable id — Puter UUID for Puter sessions, grudgeId for Grudge ID, local UUID for guests. */
  id: string;
  /** Display name shown in the toolbar. */
  name: string;
  /** Present iff signed in via Puter cloud shell. */
  puter?: PuterIdentity;
  /** Grudge ID account key when fleet JWT / ID SSO is active. */
  grudgeId?: string;
}

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  /** Real Puter session — Cloud Save / Publish / Puter AI only. */
  isPuterSignedIn: boolean;
  /** Fleet JWT present (Grudge ID) — Railway bag, Legion, characters. */
  isGrudgeSignedIn: boolean;
  setUser(user: AuthUser | null): void;
  setSignedIn(user: AuthUser): void;
  setGuest(user: AuthUser): void;
  reset(): void;
}

function grudgeFlag(user: AuthUser | null | undefined): boolean {
  return Boolean(user?.grudgeId);
}

export const useAuth = create<AuthState>((set) => ({
  status: "idle",
  user: null,
  isPuterSignedIn: false,
  isGrudgeSignedIn: false,
  setUser: (user) =>
    set({
      // Puter OR Grudge ID counts as signed-in for Welcome gate
      status: user
        ? user.puter || user.grudgeId
          ? "signedIn"
          : "guest"
        : "anon",
      user,
      isPuterSignedIn: !!user?.puter,
      isGrudgeSignedIn: grudgeFlag(user),
    }),
  setSignedIn: (user) =>
    set({
      status: "signedIn",
      user,
      // Grudge ID SSO may call setSignedIn without Puter — never fake Puter.
      isPuterSignedIn: !!user?.puter,
      isGrudgeSignedIn: grudgeFlag(user),
    }),
  setGuest: (user) =>
    set({
      status: "guest",
      user,
      isPuterSignedIn: false,
      isGrudgeSignedIn: false,
    }),
  reset: () =>
    set({
      status: "anon",
      user: null,
      isPuterSignedIn: false,
      isGrudgeSignedIn: false,
    }),
}));
