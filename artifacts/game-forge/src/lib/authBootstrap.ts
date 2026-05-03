import { useAuth, type LocalUser } from "@/store/auth";

/**
 * Local-only auth. No SDK, no popup, no server. The previous Puter Auth
 * flow opened a popup that the Replit canvas iframe sandbox routinely
 * blocked, leaving sign-in permanently broken. Identity for this editor
 * is single-player anyway — we just need a friendly name on saved work.
 *
 * Storage: a single localStorage key holding `{ id, name }` JSON.
 */
const STORAGE_KEY = "grudge.auth.localUser";

function readStored(): LocalUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalUser>;
    if (typeof parsed.id !== "string" || typeof parsed.name !== "string") {
      return null;
    }
    return { id: parsed.id, name: parsed.name };
  } catch {
    return null;
  }
}

function writeStored(user: LocalUser | null): void {
  try {
    if (user) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* private mode / quota exceeded — non-fatal, in-memory only */
  }
}

function makeGuestId(): string {
  // crypto.randomUUID is universal in modern browsers; fall back to a
  // timestamp-based id for the rare exception (very old WebViews).
  try {
    return crypto.randomUUID();
  } catch {
    return `guest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

/**
 * Boot the auth store. Called once from App.tsx on mount.
 *
 * Synchronously reads localStorage and sets the store. If a user was
 * persisted, they're back in `signedIn` immediately; otherwise `anon`.
 * No async work, no network — boot path stays instant.
 */
export function bootstrapAuth(): void {
  const stored = readStored();
  useAuth.getState().setUser(stored);
}

/**
 * Sign in with a display name. If no name is provided, generates a
 * "Player-XXXX" guest name. Persists immediately.
 */
export function signIn(name?: string): LocalUser {
  const trimmed = (name ?? "").trim();
  const finalName =
    trimmed.length > 0
      ? trimmed.slice(0, 32)
      : `Player-${Math.floor(Math.random() * 9000 + 1000)}`;
  const user: LocalUser = { id: makeGuestId(), name: finalName };
  writeStored(user);
  useAuth.getState().setUser(user);
  return user;
}

/**
 * Update the display name of the currently signed-in user. No-op if
 * no one is signed in.
 */
export function renameUser(name: string): void {
  const current = useAuth.getState().user;
  if (!current) return;
  const trimmed = name.trim().slice(0, 32);
  if (!trimmed) return;
  const updated: LocalUser = { ...current, name: trimmed };
  writeStored(updated);
  useAuth.getState().setUser(updated);
}

/**
 * Sign out: drop the persisted user and reset the store to anon.
 */
export function signOut(): void {
  writeStored(null);
  useAuth.getState().setUser(null);
}
