/**
 * Toolbar auth menu — dual plane: Grudge ID (fleet) + Puter (cloud).
 *
 * Labels never claim “Signed in” for Puter-only when Grudge is required for
 * bag/AI — chips show each plane clearly.
 */
import { useState } from "react";
import {
  LogOut,
  User as UserIcon,
  Sparkles,
  Loader2,
  Pencil,
  Check,
  X,
  Shield,
  Cloud,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/store/auth";
import {
  signInWithPuter,
  signOut,
  renameGuest,
} from "@/lib/authBootstrap";
import {
  signInWithGrudge,
  signInWithGrudgeRedirect,
  isGrudgeIdSignedIn,
  getGrudgeBearerToken,
} from "@/lib/grudgeAuthBridge";
import { FORGE_ENV } from "@/lib/forgeEnv";
import { syncAccountMirrorToPuter } from "@/lib/cloud/accountMirror";
import { toast } from "sonner";

export function UserMenu() {
  const { status, user, isPuterSignedIn, isGrudgeSignedIn } = useAuth();
  const grudgeOn = isGrudgeSignedIn || isGrudgeIdSignedIn();
  const [busy, setBusy] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [renameInput, setRenameInput] = useState("");

  async function onGrudgeSignIn() {
    if (busy) return;
    setBusy(true);
    try {
      await signInWithGrudge();
      toast.success("Signed in with Grudge ID");
      void syncAccountMirrorToPuter().catch(() => undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign-in failed.";
      if (/popup|blocked|closed/i.test(msg)) {
        toast.message("Redirecting to Grudge ID…");
        signInWithGrudgeRedirect();
        return;
      }
      toast.error(`Grudge ID: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  async function onPuterSignIn() {
    if (busy) return;
    setBusy(true);
    try {
      await signInWithPuter();
      toast.success("Puter cloud linked");
      if (getGrudgeBearerToken()) {
        void syncAccountMirrorToPuter().catch(() => undefined);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign-in failed.";
      toast.error(`Puter: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  async function onSignOut() {
    setBusy(true);
    try {
      await signOut();
      toast.message("Signed out");
    } finally {
      setBusy(false);
    }
  }

  // ---- Anonymous / pre-bootstrap ---------------------------------------
  if (status === "idle" || status === "anon" || !user) {
    return (
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="default"
              onClick={() => void onGrudgeSignIn()}
              disabled={busy}
              data-testid="button-sign-in-grudge"
              className="gap-1.5 bg-[#d4af37] text-black hover:bg-[#c4a030]"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Shield className="size-4" />
              )}
              <span className="hidden sm:inline">Grudge ID</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Sign in with Grudge ID — fleet account, games, Grudge AI
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void onPuterSignIn()}
              disabled={busy}
              data-testid="button-sign-in"
              className="gap-1.5"
            >
              <Cloud className="size-4" />
              <span className="hidden md:inline">Puter</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Puter cloud saves &amp; publish (optional)
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  // ---- Guest or signed-in ----------------------------------------------
  const initials = user.name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
  const isPuter = isPuterSignedIn || !!user.puter;
  const isTemp = user.puter?.isTemp === true;
  const isGuest = status === "guest" && !grudgeOn && !isPuter;

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) setEditingName(false);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="px-1.5 gap-2"
          data-testid="button-user-menu"
        >
          <Avatar className="size-6">
            <AvatarFallback className="text-[10px] font-mono">
              {initials || <UserIcon className="size-3" />}
            </AvatarFallback>
          </Avatar>
          <span className="hidden md:inline text-xs max-w-[120px] truncate">
            {user.name}
          </span>
          {grudgeOn && (
            <span
              className="hidden lg:inline text-[10px] px-1.5 py-0.5 rounded bg-[#d4af37]/15 text-[#d4af37] border border-[#d4af37]/30"
              title="Grudge ID JWT active"
            >
              ID
            </span>
          )}
          {isTemp && (
            <span
              className="hidden md:inline text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 border border-amber-500/30"
              title="Temporary Puter account — claim it to keep your work."
            >
              temp
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="flex items-center justify-between gap-2">
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            {editingName && isGuest ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  renameGuest(renameInput);
                  setEditingName(false);
                }}
                className="flex items-center gap-1 flex-1"
              >
                <Input
                  autoFocus
                  value={renameInput}
                  onChange={(e) => setRenameInput(e.target.value)}
                  maxLength={32}
                  className="h-7 text-sm"
                  data-testid="input-rename"
                />
                <Button type="submit" size="icon" variant="ghost" className="size-7 shrink-0">
                  <Check className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7 shrink-0"
                  onClick={() => setEditingName(false)}
                >
                  <X className="size-4" />
                </Button>
              </form>
            ) : (
              <>
                <span className="text-sm font-medium truncate">{user.name}</span>
                <span className="text-[10px] text-muted-foreground truncate">
                  {grudgeOn && isPuter
                    ? `Grudge ID · Puter @${user.puter?.username}`
                    : grudgeOn
                      ? `Grudge ID · ${user.grudgeId || "linked"}`
                      : isPuter
                        ? `Puter cloud only · @${user.puter?.username}`
                        : "Guest · local only"}
                </span>
              </>
            )}
          </div>
          {isGuest && !editingName && (
            <Button
              size="icon"
              variant="ghost"
              className="size-6 shrink-0"
              onClick={(e) => {
                e.preventDefault();
                setRenameInput(user.name);
                setEditingName(true);
              }}
              data-testid="button-rename"
            >
              <Pencil className="size-3" />
            </Button>
          )}
        </DropdownMenuLabel>

        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-[10px] text-muted-foreground space-y-1">
          <div className="flex justify-between gap-2">
            <span>Grudge ID (fleet)</span>
            <span className={grudgeOn ? "text-emerald-500" : "text-amber-500"}>
              {grudgeOn ? "on" : "off"}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span>Puter (cloud)</span>
            <span className={isPuter ? "text-emerald-500" : "text-muted-foreground"}>
              {isPuter ? "on" : "off"}
            </span>
          </div>
        </div>

        {isTemp && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                window.open("https://puter.com/?action=claim", "_blank", "noopener");
              }}
              className="gap-2 text-[#d4af37]"
              data-testid="menu-claim-account"
            >
              <Sparkles className="size-4" />
              Claim your Puter account
            </DropdownMenuItem>
          </>
        )}

        {!grudgeOn && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                void onGrudgeSignIn();
              }}
              className="gap-2"
              data-testid="menu-sign-in-grudge"
            >
              <Shield className="size-4" />
              Sign in with Grudge ID
            </DropdownMenuItem>
          </>
        )}

        {!isPuter && (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              void onPuterSignIn();
            }}
            className="gap-2"
            data-testid="menu-sign-in-puter"
          >
            <Cloud className="size-4" />
            Link Puter cloud
          </DropdownMenuItem>
        )}

        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            window.open(FORGE_ENV.openLauncher, "_blank", "noopener");
          }}
          className="gap-2"
        >
          <ExternalLink className="size-4" />
          Open library
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="gap-2 text-destructive focus:text-destructive"
          onSelect={(e) => {
            e.preventDefault();
            if (grudgeOn || isPuter) {
              void onSignOut();
            } else {
              useAuth.getState().reset();
            }
          }}
          data-testid="menu-sign-out"
        >
          <LogOut className="size-4" />
          {grudgeOn || isPuter ? "Sign out" : "Exit guest mode"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
