/**
 * First-load Welcome modal.
 *
 * Appears whenever the auth store finishes bootstrap with no user
 * (`status === "anon"`). Identity planes (fleet SSOT):
 *   - **Grudge ID** (primary) → Railway bag, characters, Legion JWT
 *   - **Puter** → User-Pays cloud saves / publish / Puter AI
 *   - **Guest** → local editor only
 *
 * Closing the dialog without choosing drops to guest so the editor
 * doesn't deadlock behind a modal the user dismissed.
 */
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, ArrowRight, Loader2, Shield, Cloud } from "lucide-react";
import { useAuth } from "@/store/auth";
import { signInWithPuter, continueAsGuest } from "@/lib/authBootstrap";
import {
  signInWithGrudge,
  signInWithGrudgeRedirect,
} from "@/lib/grudgeAuthBridge";
import { FORGE_ENV } from "@/lib/forgeEnv";

export function WelcomeModal() {
  const status = useAuth((s) => s.status);
  const [busy, setBusy] = useState<"signin" | "grudge" | "guest" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Show while still bootstrapping (idle) or when bootstrap finished with no user.
  // Without idle, a hung Puter CDN left the SPA on a blank editor with no modal.
  const open = status === "anon" || status === "idle";

  async function onGrudgeSignIn() {
    setBusy("grudge");
    setError(null);
    try {
      await signInWithGrudge();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Grudge sign-in failed.";
      // Popup closed / blocked → offer full redirect
      if (/popup|blocked|closed/i.test(msg)) {
        setError("Popup blocked or closed. Redirecting to Grudge ID…");
        signInWithGrudgeRedirect();
        return;
      }
      setError(msg);
    } finally {
      setBusy(null);
    }
  }

  async function onPuterSignIn() {
    setBusy("signin");
    setError(null);
    try {
      await signInWithPuter();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Puter sign-in failed.");
    } finally {
      setBusy(null);
    }
  }

  function onGuest() {
    setBusy("guest");
    try {
      continueAsGuest();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && status === "anon") onGuest();
      }}
    >
      <DialogContent className="max-w-md" data-testid="dialog-welcome">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-[#d4af37]" />
            Grudge Studio · Forge
          </DialogTitle>
          <DialogDescription>
            Scene editor (three.js / R3F).{" "}
            <strong className="text-foreground font-medium">Grudge ID</strong>{" "}
            unlocks fleet account, games bag, and Grudge AI.{" "}
            <strong className="text-foreground font-medium">Puter</strong> is
            optional cloud saves &amp; publish (User-Pays). Guest = local only.
          </DialogDescription>
        </DialogHeader>

        <ul className="text-xs text-muted-foreground space-y-1.5 list-disc pl-5 py-1">
          <li>
            <strong className="text-foreground/80">Grudge ID</strong> — one login
            for Open / Warlords / Foundry / Forge JWT (
            <code className="text-[10px]">{FORGE_ENV.grudgeId.replace("https://", "")}</code>
            ).
          </li>
          <li>
            <strong className="text-foreground/80">Puter</strong> — project FS/KV
            cloud; never the player bag SSOT (Railway).
          </li>
          <li>
            AI: Legion + fleet free models · optional BYOK or local Ollama.
          </li>
        </ul>

        {error && (
          <p
            className="text-xs text-destructive"
            data-testid="text-welcome-error"
          >
            {error}
          </p>
        )}

        <DialogFooter className="gap-2 flex-col sm:flex-col">
          <Button
            onClick={() => void onGrudgeSignIn()}
            disabled={busy !== null}
            className="gap-1.5 w-full bg-[#d4af37] text-black hover:bg-[#c4a030]"
            data-testid="button-welcome-grudge"
          >
            {busy === "grudge" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Shield className="size-4" />
            )}
            Sign in with Grudge ID
          </Button>
          <Button
            variant="outline"
            onClick={() => void onPuterSignIn()}
            disabled={busy !== null}
            className="gap-1.5 w-full"
            data-testid="button-welcome-signin"
          >
            {busy === "signin" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Cloud className="size-4" />
            )}
            Sign in with Puter (cloud saves)
          </Button>
          <Button
            variant="ghost"
            onClick={onGuest}
            disabled={busy !== null}
            className="gap-1.5 w-full"
            data-testid="button-welcome-guest"
          >
            Continue without signing in
            <ArrowRight className="size-4" />
          </Button>
          <button
            type="button"
            className="text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            onClick={() => signInWithGrudgeRedirect()}
            disabled={busy !== null}
          >
            Prefer full-page Grudge ID redirect
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
