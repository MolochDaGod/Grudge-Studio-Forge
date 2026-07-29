/**
 * First-load Welcome modal.
 *
 * Appears whenever the auth store finishes bootstrap with no user
 * (`status === "anon"`). Two paths:
 *   - "Sign in with Puter"  → calls signInWithPuter(); requires user click.
 *   - "Continue without signing in" → continueAsGuest(); editor works
 *     locally, cloud / publish / Puter AI models stay disabled.
 *
 * Closing the dialog without choosing also drops to guest so the editor
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
import { Sparkles, LogIn, ArrowRight, Loader2, Shield } from "lucide-react";
import { useAuth } from "@/store/auth";
import { signInWithPuter, continueAsGuest } from "@/lib/authBootstrap";
import { signInWithGrudge } from "@/lib/grudgeAuthBridge";

export function WelcomeModal() {
  const status = useAuth((s) => s.status);
  const [busy, setBusy] = useState<"signin" | "grudge" | "guest" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = status === "anon";

  async function onSignIn() {
    setBusy("signin");
    setError(null);
    try {
      await signInWithPuter();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
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
            Free Three.js editor · Grudge Forge
          </DialogTitle>
          <DialogDescription>
            Customized free three.js / R3F editor for Grudge Studio. Sign in
            with Puter for cloud saves, free Puter AI, and one-click publish —
            or continue as guest. Help → Best Services lists every free +
            fleet integration (CDN, Poly Haven, Groq, Ollama…).
          </DialogDescription>
        </DialogHeader>

        <ul className="text-xs text-muted-foreground space-y-1.5 list-disc pl-5 py-1">
          <li>
            Scene editor DNA: hierarchy, inspector, gizmos, undo — three.js
            editor parity with Rapier physics.
          </li>
          <li>
            Free AI: Puter models, BYOK Groq / OpenRouter / Gemini, or local
            Ollama — no paid Anthropic key required.
          </li>
          <li>
            Assets: Poly Haven CC0 + Grudge CDN / ObjectStore · publish to{" "}
            <code>*.puter.site</code> or fleet play.
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
            onClick={onSignIn}
            disabled={busy !== null}
            className="gap-1.5 w-full"
            data-testid="button-welcome-signin"
          >
            {busy === "signin" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <LogIn className="size-4" />
            )}
            Sign in with Puter
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              setBusy("grudge");
              setError(null);
              try {
                await signInWithGrudge();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Grudge sign-in failed.");
              } finally {
                setBusy(null);
              }
            }}
            disabled={busy !== null}
            className="gap-1.5 w-full border-[#d4af37]/40 text-[#d4af37] hover:bg-[#d4af37]/10"
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
            variant="ghost"
            onClick={onGuest}
            disabled={busy !== null}
            className="gap-1.5 w-full"
            data-testid="button-welcome-guest"
          >
            Continue without signing in
            <ArrowRight className="size-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
