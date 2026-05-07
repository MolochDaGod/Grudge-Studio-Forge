/**
 * Toolbar entry point for Puter sign-in.
 *
 * Anonymous / guest → "Sign in" button. Clicking calls `signInWithPuter()`
 *                     (which opens Puter's popup; requires a user click).
 *                     Guests also get a name affordance via the dropdown.
 *
 * Signed-in (Puter) → avatar + dropdown with display name, the Puter
 *                     username, an optional "Claim your account" chip
 *                     for `is_temp` users, and sign-out.
 */
import { useState } from "react";
import { LogIn, LogOut, User as UserIcon, Sparkles, Loader2, Pencil, Check, X } from "lucide-react";
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
import { useAuth as useAuthStore } from "@/store/auth";
import { toast } from "sonner";

export function UserMenu() {
  const { status, user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [renameInput, setRenameInput] = useState("");

  async function onSignIn() {
    if (busy) return;
    setBusy(true);
    try {
      await signInWithPuter();
      toast.success("Signed in with Puter");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign-in failed.";
      toast.error(`Sign-in failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  async function onSignOut() {
    setBusy(true);
    try {
      await signOut();
    } finally {
      setBusy(false);
    }
  }

  // ---- Anonymous / pre-bootstrap ---------------------------------------
  if (status === "idle" || status === "anon" || !user) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            onClick={onSignIn}
            disabled={busy}
            data-testid="button-sign-in"
            className="gap-1.5"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <LogIn className="size-4" />
            )}
            <span className="hidden sm:inline">Sign in</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Sign in with Puter to enable cloud saves &amp; publishing.
        </TooltipContent>
      </Tooltip>
    );
  }

  // ---- Signed in (Puter or guest) --------------------------------------
  const initials = user.name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
  const isPuter = !!user.puter;
  const isTemp = user.puter?.isTemp === true;

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

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center justify-between gap-2">
          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
            {editingName && !isPuter ? (
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
                {isPuter && (
                  <span className="text-[10px] text-muted-foreground truncate">
                    Puter · @{user.puter?.username}
                  </span>
                )}
                {!isPuter && (
                  <span className="text-[10px] text-muted-foreground">
                    Guest · cloud features disabled
                  </span>
                )}
              </>
            )}
          </div>
          {!isPuter && !editingName && (
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

        {!isPuter && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                void onSignIn();
              }}
              className="gap-2"
              data-testid="menu-sign-in-puter"
            >
              <LogIn className="size-4" />
              Sign in with Puter
            </DropdownMenuItem>
          </>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="gap-2 text-destructive focus:text-destructive"
          onSelect={(e) => {
            e.preventDefault();
            if (isPuter) {
              void onSignOut();
            } else {
              // Guest "sign out" returns to the anon decision point (Welcome
              // modal) rather than re-entering guest mode, so the user can
              // pick Sign-in-with-Puter or stay as a guest fresh.
              useAuthStore.getState().reset();
            }
          }}
          data-testid="menu-sign-out"
        >
          <LogOut className="size-4" />
          {isPuter ? "Sign out" : "Exit guest mode"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
