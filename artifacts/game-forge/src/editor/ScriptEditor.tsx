import Editor from "@monaco-editor/react";
import { useState, useEffect, useMemo } from "react";
import {
  useListScripts,
  useCreateScript,
  useUpdateScript,
  useDeleteScript,
  getListScriptsQueryKey,
  getGetProjectSummaryQueryKey,
} from "@workspace/api-client-react";
import type { Script } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEditor } from "@/store/editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Save, Loader2, Code2, Sparkles } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SCRIPT_TEMPLATES, getTemplate } from "@/ai/tools/scripting/templates";
import { SMART_SCRIPT_TEMPLATE_KEYS } from "@/lib/inspectorCatalogs";

/** Smart starter kits — SSOT in inspectorCatalogs (Inspector shares this list). */
const SMART_TEMPLATE_KEYS = SMART_SCRIPT_TEMPLATE_KEYS;

export function ScriptEditor() {
  const projectId = useEditor((s) => s.projectId);
  const pushLog = useEditor((s) => s.pushLog);
  const qc = useQueryClient();
  const { data: scripts = [], isLoading } = useListScripts(projectId ?? 0, {
    query: { queryKey: getListScriptsQueryKey(projectId ?? 0), enabled: !!projectId },
  });

  const [activeId, setActiveId] = useState<number | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [draftName, setDraftName] = useState<string>("");
  const [newLanguage, setNewLanguage] = useState<"js" | "ts" | "cs">("js");
  const [templateKey, setTemplateKey] = useState<string>("wasd-character-controller");

  const active = useMemo<Script | undefined>(
    () => scripts.find((s) => s.id === activeId),
    [scripts, activeId],
  );

  // Auto-select first script
  useEffect(() => {
    if (!activeId && scripts.length > 0) {
      setActiveId(scripts[0].id);
    }
  }, [scripts, activeId]);

  // Sync draft when active changes
  useEffect(() => {
    if (active) {
      setDraft(active.code);
      setDraftName(active.name);
    }
  }, [active?.id, active?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const createScript = useCreateScript();
  const updateScript = useUpdateScript();
  const deleteScript = useDeleteScript();

  const onNew = async () => {
    if (!projectId) return;
    const res = await createScript.mutateAsync({
      data: {
        projectId,
        name: `Script ${scripts.length + 1}`,
        language: newLanguage,
        code: newLanguage === "cs" ? "// C# Blazor script\n" : "// New script\nexports.update = function(entity, ctx) {\n  // ...\n};\n",
      },
    });
    qc.invalidateQueries({ queryKey: getListScriptsQueryKey(projectId) });
    qc.invalidateQueries({ queryKey: getGetProjectSummaryQueryKey(projectId) });
    setActiveId(res.id);
    pushLog("info", `Created ${newLanguage.toUpperCase()} script "${res.name}"`);
  };

  const onNewFromTemplate = async () => {
    if (!projectId) return;
    const tpl = getTemplate(templateKey);
    if (!tpl) {
      pushLog("error", `Unknown template "${templateKey}"`);
      return;
    }
    const code = tpl.render({});
    const res = await createScript.mutateAsync({
      data: {
        projectId,
        name: tpl.name,
        language: "js",
        code,
      },
    });
    qc.invalidateQueries({ queryKey: getListScriptsQueryKey(projectId) });
    qc.invalidateQueries({ queryKey: getGetProjectSummaryQueryKey(projectId) });
    setActiveId(res.id);
    pushLog("info", `Created script from template "${tpl.key}"`);
  };

  const smartTemplates = useMemo(
    () =>
      SMART_TEMPLATE_KEYS.map((k) => getTemplate(k)).filter(
        (t): t is NonNullable<typeof t> => !!t,
      ),
    [],
  );

  const onSave = async () => {
    if (!active || !projectId) return;
    await updateScript.mutateAsync({
      id: active.id,
      data: { name: draftName, code: draft },
    });
    qc.invalidateQueries({ queryKey: getListScriptsQueryKey(projectId) });
    pushLog("info", `Saved script "${draftName}"`);
  };

  const onDelete = async () => {
    if (!active || !projectId) return;
    if (!confirm(`Delete script "${active.name}"?`)) return;
    await deleteScript.mutateAsync({ id: active.id });
    qc.invalidateQueries({ queryKey: getListScriptsQueryKey(projectId) });
    qc.invalidateQueries({ queryKey: getGetProjectSummaryQueryKey(projectId) });
    setActiveId(null);
  };

  if (!projectId) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Open a project to manage scripts.
      </div>
    );
  }

  // Handle entity drops from the Hierarchy — create a script for the dropped entity
  const handleEntityDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const entityId = e.dataTransfer.getData("text/entity-id");
    if (!entityId || !projectId) return;
    const entity = useEditor.getState().sceneData.entities.find((en) => en.id === entityId);
    if (!entity) return;
    // Create a new script named after the entity
    const res = await createScript.mutateAsync({
      data: {
        projectId,
        name: `${entity.name} Script`,
        language: "js",
        code: `// Script for "${entity.name}" (${entity.type})\n// This script was auto-created by dropping the entity onto the Scripts tab.\n\nexports.start = function(entity, ctx) {\n  ctx.log("${entity.name} script started");\n};\n\nexports.update = function(entity, ctx) {\n  // Your logic here — runs every frame\n};\n`,
      },
    });
    qc.invalidateQueries({ queryKey: getListScriptsQueryKey(projectId) });
    qc.invalidateQueries({ queryKey: getGetProjectSummaryQueryKey(projectId) });
    // Attach the script to the entity
    useEditor.getState().setEntityScript(entityId, res.id);
    setActiveId(res.id);
    pushLog("info", `Created & attached script "${entity.name} Script" to ${entity.name}`);
  };

  return (
    <div
      className="grid grid-cols-[200px_1fr] h-full"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("text/entity-id")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={handleEntityDrop}
    >
      {/* Script list */}
      <div className="border-r border-border flex flex-col bg-card/40">
        <div className="p-2 border-b border-border space-y-1.5">
          <div className="flex gap-1">
            <Select value={newLanguage} onValueChange={(v) => setNewLanguage(v as "js" | "ts" | "cs")}>
              <SelectTrigger className="h-7 text-xs flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="js">JavaScript</SelectItem>
                <SelectItem value="ts">TypeScript</SelectItem>
                <SelectItem value="cs">C# (Blazor)</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" className="h-7 px-2" onClick={onNew} data-testid="button-new-script" title="Blank script">
              <Plus className="size-3.5" />
            </Button>
          </div>
          <div className="flex gap-1 items-center">
            <Select value={templateKey} onValueChange={setTemplateKey}>
              <SelectTrigger className="h-7 text-[10px] flex-1" data-testid="select-script-template">
                <SelectValue placeholder="Smart template" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {smartTemplates.map((t) => (
                  <SelectItem key={t.key} value={t.key} className="text-xs">
                    {t.name}
                  </SelectItem>
                ))}
                <SelectItem value="__all__" disabled className="text-[10px] opacity-60">
                  — all {SCRIPT_TEMPLATES.length} via AI list_script_templates —
                </SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="secondary"
              className="h-7 px-2"
              onClick={() => void onNewFromTemplate()}
              disabled={createScript.isPending || templateKey === "__all__"}
              data-testid="button-new-from-template"
              title="Create from smart template"
            >
              <Sparkles className="size-3.5" />
            </Button>
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-1 space-y-0.5">
            {isLoading && <p className="text-xs text-muted-foreground p-2">Loading…</p>}
            {!isLoading && scripts.length === 0 && (
              <p className="text-xs text-muted-foreground p-2 text-center">No scripts yet.</p>
            )}
            {scripts.map((s) => (
              <div
                key={s.id}
                onClick={() => setActiveId(s.id)}
                className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer hover-elevate ${
                  activeId === s.id ? "bg-primary/15 text-primary border border-primary/30" : ""
                }`}
                data-testid={`script-item-${s.id}`}
              >
                <Code2 className="size-3 shrink-0" />
                <span className="flex-1 truncate">{s.name}</span>
                <span className="text-[10px] text-accent font-mono">{s.language}</span>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Editor */}
      <div className="flex flex-col min-w-0">
        {active ? (
          <>
            <div className="p-2 border-b border-border flex items-center gap-2 bg-card/30">
              <Input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                className="h-7 text-xs max-w-xs"
                data-testid="input-script-name"
              />
              <span className="text-[10px] uppercase font-mono text-muted-foreground px-2 py-0.5 rounded bg-secondary">
                {active.language}
              </span>
              <div className="flex-1" />
              <Button size="sm" variant="outline" onClick={onDelete} data-testid="button-delete-script">
                <Trash2 className="size-3 mr-1" /> Delete
              </Button>
              <Button size="sm" onClick={onSave} disabled={updateScript.isPending} data-testid="button-save-script">
                {updateScript.isPending ? (
                  <Loader2 className="size-3 mr-1 animate-spin" />
                ) : (
                  <Save className="size-3 mr-1" />
                )}
                Save
              </Button>
            </div>
            <div className="flex-1 min-h-0">
              <Editor
                language={
  active.language === "cs"
    ? "csharp"
    : active.language === "ts"
      ? "typescript"
      : "javascript"
}
                value={draft}
                onChange={(v) => setDraft(v ?? "")}
                theme="vs-dark"
                options={{
                  minimap: { enabled: false },
                  fontSize: 12,
                  fontFamily: "JetBrains Mono, Menlo, monospace",
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  wordWrap: "on",
                  renderLineHighlight: "all",
                  tabSize: 2,
                }}
              />
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            {scripts.length === 0 ? "Click + to create your first script." : "Select a script to edit."}
          </div>
        )}
      </div>
    </div>
  );
}
