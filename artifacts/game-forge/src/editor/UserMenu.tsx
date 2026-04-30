import { useState } from "react";
import {
  CloudCog,
  ExternalLink,
  Loader2,
  LogIn,
  LogOut,
  Sparkles,
  User as UserIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/store/auth";
import { signInWithPuter, signOut } from "@/lib/authBootstrap";

/**
 * Toolbar entry point for Grudge Studio Puter Auth.
 *
 * Anonymous → renders a "Sign in with Grudge Studio" button that
 *             triggers the Puter sign-in popup and a one-shot server
 *             sync to mirror the user into the shared `users` table.
 *             The editor stays in place; the user just gets a richer
 *             identity surface (Grudge ID, avatar, upstream link).
 *
 * Signed-in → renders an avatar + dropdown showing the user's display
 *             name, Grudge ID, and an upstream-account indicator (so
 *             the user knows whether their identity is mirrored in the
 *             wider Grudge ecosystem yet).
 */
export function UserMenu() {
  const { status, user, error, config } = useAuth();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const inFlight = busy || status === "loading";

  const handleSignIn = async () => {
    if (inFlight) return;
    setBusy(true);
    try {
      await signInWithPuter();
      toast({
        title: "Signed in to Grudge Studio",
        description: "Your Puter cloud storage is now connected.",
      });
    } catch (err) {
      toast({
        title: "Sign-in failed",
        description: (err as Error).message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    if (inFlight) return;
    setBusy(true);
    try {
      await signOut();
      toast({ title: "Signed out", description: "See you soon!" });
    } finally {
      setBusy(false);
    }
  };

  // ---- Anonymous / loading ----------------------------------------------
  if (status !== "signedIn" || !user) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSignIn}
              disabled={inFlight}
              data-testid="button-sign-in"
              className="gap-1.5"
            >
              {inFlight ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <LogIn className="size-4" />
              )}
              <span className="hidden sm:inline">Sign in</span>
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[220px]">
          {status === "error" && error
            ? error
            : "Sign in with Grudge Studio (Puter) to enable cloud save and sync."}
        </TooltipContent>
      </Tooltip>
    );
  }

  // ---- Signed in --------------------------------------------------------
  const initials = (user.displayName ?? user.username)
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="px-1.5 gap-2"
          data-testid="button-user-menu"
        >
          <Avatar className="size-6">
            {user.avatarUrl ? (
              <AvatarImage src={user.avatarUrl} alt={user.username} />
            ) : null}
            <AvatarFallback className="text-[10px] font-mono">
              {initials || <UserIcon className="size-3" />}
            </AvatarFallback>
          </Avatar>
          <span className="hidden md:inline text-xs max-w-[120px] truncate">
            {user.displayName ?? user.username}
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-sm font-medium truncate">
            {user.displayName ?? user.username}
          </span>
          {user.email ? (
            <span className="text-[11px] text-muted-foreground truncate">
              {user.email}
            </span>
          ) : null}
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <div className="px-2 py-1.5 text-[11px] font-mono text-muted-foreground space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="opacity-60">Grudge ID</span>
            <span className="truncate" title={user.grudgeId}>
              {user.grudgeId}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="opacity-60">Puter UUID</span>
            <span className="truncate" title={user.puterUuid}>
              {user.puterUuid.slice(0, 8)}…
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <span className="opacity-60">Upstream account</span>
            {user.hasGrudgeAccount ? (
              <span className="inline-flex items-center gap-1 text-emerald-500">
                <Sparkles className="size-3" /> Linked
              </span>
            ) : (
              <span className="text-amber-500">Local only</span>
            )}
          </div>
        </div>

        {config?.enablePuterCloud ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2"
              onSelect={(e) => {
                e.preventDefault();
                toast({
                  title: "Cloud storage ready",
                  description: `Files sync to puter://${config.puterBasePath.replace(/^\//, "")}/${user.grudgeId}`,
                });
              }}
              data-testid="menu-cloud-info"
            >
              <CloudCog className="size-4" /> Cloud storage
              <span className="ml-auto text-[10px] text-muted-foreground">
                Connected
              </span>
            </DropdownMenuItem>
          </>
        ) : null}

        {config?.grudgeAuthUrl ? (
          <DropdownMenuItem
            className="gap-2"
            onSelect={() => {
              window.open(
                config.grudgeAuthUrl ?? undefined,
                "_blank",
                "noopener,noreferrer",
              );
            }}
            data-testid="menu-grudge-dashboard"
          >
            <ExternalLink className="size-4" /> Grudge Studio dashboard
          </DropdownMenuItem>
        ) : null}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="gap-2 text-destructive focus:text-destructive"
          disabled={inFlight}
          onSelect={(e) => {
            e.preventDefault();
            void handleSignOut();
          }}
          data-testid="menu-sign-out"
        >
          {inFlight ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <LogOut className="size-4" />
          )}
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
