import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState } from "react";
import {
  useListProjects,
  useCreateProject,
  useDeleteProject,
  useGetProjectSummary,
  getListProjectsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEditor } from "@/store/editor";
import { useAuth } from "@/store/auth";
import { signInWithPuter } from "@/lib/authBootstrap";
import {
  FolderOpen,
  Plus,
  Trash2,
  Loader2,
  Sparkles,
  Cloud,
  HardDrive,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

export function ProjectPicker({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const setProject = useEditor((s) => s.setProject);
  const projectId = useEditor((s) => s.projectId);
  const isPuter = useAuth((s) => s.isPuterSignedIn);
  const authStatus = useAuth((s) => s.status);
  const { toast } = useToast();

  // Coerce to array defensively. The destructure pattern `data: projects = []`
  // only fires when `data` is `undefined`; a `null` (from any future empty- or
  // non-array success body the customFetch surfaces) would slip through and
  // crash on `.map()`. `Array.isArray` is the only invariant that actually
  // matches what the consumer needs.
  const { data, isLoading } = useListProjects();
  const projects = Array.isArray(data) ? data : [];
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  const storageLabel = isPuter ? "Puter cloud (Grudge)" : "This browser (local)";
  const storageHint = isPuter
    ? "Projects sync to your Puter drive (KV index + FS scene JSON)."
    : "Projects stay in this browser until you sign in with Puter.";

  const onCreate = async () => {
    if (!name.trim()) return;
    const res = await createProject.mutateAsync({ data: { name: name.trim(), description: description.trim() } });
    qc.invalidateQueries({ queryKey: getListProjectsQueryKey() });
    // Seeded "Main" scene lives under scenes index — Hierarchy auto-loads it.
    qc.invalidateQueries({ queryKey: ["scenes"] });
    setProject(res.id);
    setName("");
    setDescription("");
    toast({
      title: isPuter ? "Project saved to Puter cloud" : "Project saved locally",
      description: isPuter
        ? `"${res.name}" · sign-in keeps it across devices`
        : `"${res.name}" · use Sign in with Puter for cloud sync`,
    });
    onOpenChange(false);
  };

  const onOpen = (id: number) => {
    setProject(id);
    // Force scene list refetch so first scene hydrates into the viewport.
    qc.invalidateQueries({ queryKey: ["scenes", id] });
    onOpenChange(false);
  };

  const onDelete = async (id: number) => {
    if (!confirm("Delete this project and all of its scenes/scripts/assets?")) return;
    await deleteProject.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: getListProjectsQueryKey() });
    if (projectId === id) setProject(null);
  };

  const onSignInPuter = async () => {
    setSigningIn(true);
    try {
      await signInWithPuter();
      qc.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      toast({
        title: "Signed in with Puter",
        description: "Projects now save to your Grudge Puter cloud.",
      });
    } catch (err) {
      toast({
        title: "Puter sign-in failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" /> Forge Projects
          </DialogTitle>
          <DialogDescription>
            Open or create a project. Storage: <strong>{storageLabel}</strong>.
            {" "}{storageHint}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs">
          {isPuter ? (
            <>
              <Cloud className="size-3.5 text-sky-400" />
              <Badge variant="outline" className="text-[10px] h-5 border-sky-500/40 text-sky-300">
                Puter cloud
              </Badge>
              <span className="text-muted-foreground">Grudge drive · multi-device</span>
            </>
          ) : (
            <>
              <HardDrive className="size-3.5 text-violet-400" />
              <Badge variant="outline" className="text-[10px] h-5 border-violet-500/40 text-violet-300">
                Local browser
              </Badge>
              <span className="text-muted-foreground">localStorage · this device</span>
              {authStatus !== "idle" && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 ml-auto text-[11px]"
                  onClick={() => void onSignInPuter()}
                  disabled={signingIn}
                  data-testid="button-projects-puter-signin"
                >
                  {signingIn ? (
                    <Loader2 className="size-3.5 mr-1 animate-spin" />
                  ) : (
                    <Cloud className="size-3.5 mr-1" />
                  )}
                  Sign in with Puter
                </Button>
              )}
            </>
          )}
        </div>

        <div className="grid grid-cols-2 gap-6 py-2">
          {/* Existing projects */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Your Projects</Label>
            <ScrollArea className="h-72 border border-border rounded-md">
              <div className="p-2 space-y-1">
                {isLoading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground p-2">
                    <Loader2 className="size-4 animate-spin" /> Loading...
                  </div>
                )}
                {!isLoading && projects.length === 0 && (
                  <p className="text-sm text-muted-foreground p-3">No projects yet — create one →</p>
                )}
                {projects.map((p) => (
                  <ProjectRow key={p.id} project={p} onOpen={() => onOpen(p.id)} onDelete={() => onDelete(p.id)} />
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* New project */}
          <div className="space-y-3">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">New Project</Label>
            <div className="space-y-2">
              <Label htmlFor="np-name" className="text-xs">
                Name
              </Label>
              <Input
                id="np-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Battle Arena Prototype"
                data-testid="input-new-project-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="np-desc" className="text-xs">
                Description
              </Label>
              <Textarea
                id="np-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What are you building?"
                rows={4}
                data-testid="input-new-project-desc"
              />
            </div>
            <Button
              onClick={onCreate}
              disabled={!name.trim() || createProject.isPending}
              className="w-full"
              data-testid="button-create-project"
            >
              {createProject.isPending ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Plus className="size-4 mr-2" />
              )}
              Create Project
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProjectRow({
  project,
  onOpen,
  onDelete,
}: {
  project: { id: number; name: string; description: string; updatedAt: string };
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { data: summary } = useGetProjectSummary(project.id);
  return (
    <div
      className="group flex items-start gap-2 p-2 rounded-md hover-elevate cursor-pointer"
      onClick={onOpen}
      data-testid={`project-row-${project.id}`}
    >
      <FolderOpen className="size-4 mt-0.5 text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{project.name}</div>
        {project.description && (
          <div className="text-xs text-muted-foreground truncate">{project.description}</div>
        )}
        {summary && (
          <div className="text-[10px] text-muted-foreground/80 font-mono mt-1">
            {summary.sceneCount} scenes · {summary.entityCount} entities · {summary.scriptCount} scripts
          </div>
        )}
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}
