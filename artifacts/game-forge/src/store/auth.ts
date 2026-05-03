import { create } from "zustand";

/**
 * Editor-side auth store — local-only.
 *
 * Sign-in is intentionally trivial: the user picks a display name (or
 * accepts the auto-generated guest name) and we persist it to
 * localStorage. There is no popup, no SDK, no server round-trip, and no
 * shared `users` table. This is a single-player editor; identity exists
 * only so saved projects/screenshots can be tagged with a friendly name.
 *
 * The store keeps the same `AuthStatus` enum the rest of the editor was
 * already reading (Toolbar: `status === "signedIn"`), so consumers don't
 * have to change.
 */
export type AuthStatus = "idle" | "anon" | "signedIn";

export interface LocalUser {
  /** Stable id generated on first sign-in; persisted forever. */
  id: string;
  /** Display name shown in the toolbar. User-editable. */
  name: string;
}

interface AuthState {
  status: AuthStatus;
  user: LocalUser | null;
  setUser(user: LocalUser | null): void;
}

export const useAuth = create<AuthState>((set) => ({
  status: "idle",
  user: null,
  setUser: (user) => set({ status: user ? "signedIn" : "anon", user }),
}));
