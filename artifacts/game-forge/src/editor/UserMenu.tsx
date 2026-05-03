import { useState } from "react";
import { LogIn, LogOut, User as UserIcon, Pencil, Check, X } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/store/auth";
import { signIn, signOut, renameUser } from "@/lib/authBootstrap";

/**
 * Toolbar entry point for local sign-in.
 *
 * Anonymous → "Sign in" button opens a tiny name dialog. Submitting
 *             persists the user to localStorage and closes the dialog.
 *             Empty submit auto-generates a "Player-XXXX" guest name.
 *
 * Signed-in → avatar + dropdown with display name, an inline rename
 *             field, and sign-out.
 *
 * No popups, no SDK, no server round-trips — this whole module is
 * synchronous and works inside the Replit canvas iframe sandbox.
 */
export function UserMenu() {
  const { status, user } = useAuth();
  const [signInOpen, setSignInOpen] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [renameInput, setRenameInput] = useState("");

  // ---- Anonymous --------------------------------------------------------
  if (status !== "signedIn" || !user) {
    return (
      <>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setNameInput("");
                setSignInOpen(true);
              }}
              data-testid="button-sign-in"
              className="gap-1.5"
            >
              <LogIn className="size-4" />
              <span className="hidden sm:inline">Sign in</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Pick a display name for your saved projects.
          </TooltipContent>
        </Tooltip>

        <Dialog open={signInOpen} onOpenChange={setSignInOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Sign in</DialogTitle>
              <DialogDescription>
                Pick a display name. Stored locally — leave blank for a
                guest name.
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                signIn(nameInput);
                setSignInOpen(false);
              }}
              className="space-y-3 py-1"
            >
              <Input
                autoFocus
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Your name"
                maxLength={32}
                data-testid="input-sign-in-name"
              />
              <DialogFooter className="gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setSignInOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" data-testid="button-sign-in-submit">
                  Sign in
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // ---- Signed in --------------------------------------------------------
  const initials = user.name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

  const commitRename = () => {
    renameUser(renameInput);
    setEditingName(false);
  };

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
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center justify-between gap-2">
          {editingName ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                commitRename();
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
              <Button
                type="submit"
                size="icon"
                variant="ghost"
                className="size-7 shrink-0"
              >
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
            </>
          )}
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="gap-2 text-destructive focus:text-destructive"
          onSelect={(e) => {
            e.preventDefault();
            signOut();
          }}
          data-testid="menu-sign-out"
        >
          <LogOut className="size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
