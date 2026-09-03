/**
 * Tool dispatcher for AI providers with low tool-count limits (e.g. Groq ≤128).
 *
 * Instead of sending 150+ tool definitions on every request, we expose:
 *   - `list_tools` (grouped by domain)
 *   - `call_tool` (dynamic dispatch by name)
 *   - Small always-on set (~5-8 tools)
 *
 * The model calls `list_tools` first to see what's available, then `call_tool`
 * to execute specific tools by name. This keeps the wire payload under 128 tools.
 */
import { runTool, TOOL_DEFS, type ToolDef, type ToolResult } from "@/lib/aiTools";

/**
 * Group tools by domain for easier discovery.
 * The AI can call `list_tools({ domain })` to see only relevant tools.
 */
function groupToolsByDomain(): Record<string, ToolDef[]> {
  const groups: Record<string, ToolDef[]> = {
    scene: [],
    script: [],
    nav: [],
    materials: [],
    physics: [],
    design: [],
    assets: [],
    knowledge: [],
    systems: [],
    effects: [],
    puter: [],
    stats: [],
    ui: [],
    other: [],
  };

  for (const tool of TOOL_DEFS) {
    const name = tool.name.toLowerCase();
    if (
      name.includes("script") ||
      name.includes("behavior") ||
      name.includes("animation") ||
      name.includes("attach")
    ) {
      groups.script.push(tool);
    } else if (name.includes("nav") || name.includes("path") || name.includes("surface")) {
      groups.nav.push(tool);
    } else if (name.includes("material") || name.includes("texture") || name.includes("map")) {
      groups.materials.push(tool);
    } else if (name.includes("physics") || name.includes("layer") || name.includes("collid")) {
      groups.physics.push(tool);
    } else if (
      name.includes("entity") ||
      name.includes("scene") ||
      name.includes("environment") ||
      name.includes("clear") ||
      name.includes("update") ||
      name.includes("delete") ||
      name.includes("add_")
    ) {
      groups.scene.push(tool);
    } else if (
      name.includes("asset") ||
      name.includes("fast") ||
      name.includes("fleet") ||
      name.includes("builtin") ||
      name.includes("vfx") ||
      name.includes("spawn") ||
      name.includes("search")
    ) {
      groups.assets.push(tool);
    } else if (
      name.includes("arrange") ||
      name.includes("frame") ||
      name.includes("capture") ||
      name.includes("palette") ||
      name.includes("polish")
    ) {
      groups.design.push(tool);
    } else if (name.includes("knowledge") || name.includes("brain") || name.includes("doc")) {
      groups.knowledge.push(tool);
    } else if (name.includes("diagnose") || name.includes("verify") || name.includes("list_")) {
      groups.systems.push(tool);
    } else if (name.includes("wind") || name.includes("soft") || name.includes("weather")) {
      groups.effects.push(tool);
    } else if (name.includes("puter") || name.includes("cloud")) {
      groups.puter.push(tool);
    } else if (name.includes("stat") || name.includes("attribute") || name.includes("modifier")) {
      groups.stats.push(tool);
    } else if (name.includes("ui_") || name.includes("ui-")) {
      groups.ui.push(tool);
    } else {
      groups.other.push(tool);
    }
  }

  return groups;
}

/**
 * Build the dispatcher tool set (<128 tools) for providers like Groq.
 * Always includes: list_tools, call_tool, plus a small always-on set.
 */
export function buildDispatcherTools(): ToolDef[] {
  const alwaysOn: string[] = [
    "get_scene_summary",
    "list_entities",
    "diagnose_scene",
    "list_fast_assets",
    "list_threejs_standards",
    "verify_scene_full",
  ];

  const coreTools = TOOL_DEFS.filter((t) => alwaysOn.includes(t.name));

  return [
    {
      name: "list_tools",
      description:
        "List all available AI tools, optionally filtered by domain. Call this first to discover what tools you can use. Domains: scene, script, nav, materials, physics, design, assets, knowledge, systems, effects, puter, stats, ui, other. Returns tool names and descriptions grouped by domain.",
      input_schema: {
        type: "object",
        properties: {
          domain: {
            type: "string",
            description:
              "Optional domain filter: scene | script | nav | materials | physics | design | assets | knowledge | systems | effects | puter | stats | ui | other. Omit to list all domains.",
          },
        },
      },
    },
    {
      name: "call_tool",
      description:
        "Execute a specific tool by name with the given arguments. Use list_tools first to discover available tools and their parameter schemas. Returns the tool's result (ok + data or error).",
      input_schema: {
        type: "object",
        required: ["name", "arguments"],
        properties: {
          name: {
            type: "string",
            description: "Exact tool name from list_tools (e.g. 'add_entity', 'spawn_fast_asset').",
          },
          arguments: {
            type: "object",
            description:
              "Tool arguments as a JSON object. Match the input_schema from list_tools.",
          },
        },
      },
    },
    ...coreTools,
  ];
}

/**
 * Dispatcher executor for `list_tools` — returns grouped tool catalog.
 */
export async function executeListTools(input: { domain?: string }): Promise<ToolResult> {
  const groups = groupToolsByDomain();
  const domain = typeof input.domain === "string" ? input.domain.toLowerCase() : null;

  if (domain && domain in groups) {
    const tools = groups[domain];
    return {
      ok: true,
      data: {
        domain,
        count: tools.length,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema,
        })),
      },
    };
  }

  // No filter: return all domains with counts
  const summary: Record<string, { count: number; sample: string[] }> = {};
  for (const [dom, tools] of Object.entries(groups)) {
    if (tools.length === 0) continue;
    summary[dom] = {
      count: tools.length,
      sample: tools.slice(0, 3).map((t) => t.name),
    };
  }

  return {
    ok: true,
    data: {
      totalTools: TOOL_DEFS.length,
      domains: summary,
      tip: "Call list_tools({ domain: 'scene' }) to see full tool definitions for a specific domain.",
    },
  };
}

/**
 * Dispatcher executor for `call_tool` — looks up and runs a tool by name.
 */
export async function executeCallTool(input: {
  name: string;
  arguments: Record<string, unknown>;
}): Promise<ToolResult> {
  const name = String(input.name ?? "");
  if (!name) {
    return { ok: false, error: "call_tool requires 'name' parameter" };
  }

  const args = input.arguments ?? {};
  if (typeof args !== "object" || Array.isArray(args)) {
    return {
      ok: false,
      error: "call_tool 'arguments' must be a JSON object",
    };
  }

  // Verify tool exists
  const toolDef = TOOL_DEFS.find((t) => t.name === name);
  if (!toolDef) {
    return {
      ok: false,
      error: `Unknown tool "${name}". Call list_tools first to see available tools.`,
    };
  }

  // Execute via the standard runTool path
  return await runTool(name, args);
}

/**
 * Check if a provider requires the dispatcher (e.g. Groq with 128-tool limit).
 */
export function shouldUseDispatcher(provider: string): boolean {
  return provider === "groq";
}
