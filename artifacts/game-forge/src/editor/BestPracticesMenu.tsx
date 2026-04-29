import {
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { Lightbulb } from "lucide-react";
import { useEditor } from "@/store/editor";
import { getBestPractices, type BestPracticeContext } from "@/lib/bestPractices";

export function BestPracticesSubMenu({
  context,
  label = "Best practices",
}: {
  context: BestPracticeContext;
  label?: string;
}) {
  const pushLog = useEditor((s) => s.pushLog);
  const tips = getBestPractices(context);
  if (tips.length === 0) return null;

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <Lightbulb className="size-3.5 mr-2 text-accent" />
        {label}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="max-w-[360px]">
        <ContextMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Tips for {context.replace("-", " ")}
        </ContextMenuLabel>
        <ContextMenuSeparator />
        {tips.map((tip, i) => (
          <ContextMenuItem
            key={i}
            onClick={() => pushLog("info", `Tip · ${tip.title} — ${tip.detail}`)}
            className="flex flex-col items-start gap-0.5 py-1.5 cursor-default"
          >
            <span className="text-xs font-medium leading-tight">{tip.title}</span>
            <span className="text-[10px] text-muted-foreground leading-snug whitespace-normal">
              {tip.detail}
            </span>
          </ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
