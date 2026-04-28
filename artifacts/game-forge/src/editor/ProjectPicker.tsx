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
import { FolderOpen, Plus, Trash2, Loader2, Sparkles } from "lucide-react";

export function ProjectPicker({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const setProject = useEditor((s) => s.setProject);
  const projectId = useEditor((s) => s.projectId);

  const { data: projects = [], isLoading } = useListProjects();
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const onCreate = async () => {
    if (!name.trim()) return;
    const res = await createProject.mutateAsync({ data: { name: name.trim(), description: description.trim() } });
    qc.invalidateQueries({ queryKey: getListProjectsQueryKey() });
    setProject(res.id);
    setName("");
    setDescription("");
    onOpenChange(false);
  };

  const onOpen = (id: number) => {
    setProject(id);
    onOpenChange(false);
  };

  const onDelete = async (id: number) => {
    if (!confirm("Delete this project and all of its scenes/scripts/assets?")) return;
    await deleteProject.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: getListProjectsQueryKey() });
    if (projectId === id) setProject(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" /> GameForge Projects
          </DialogTitle>
          <DialogDescription>
            Open an existing project, or create a new one to start prototyping.
          </DialogDescription>
        </DialogHeader>

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
