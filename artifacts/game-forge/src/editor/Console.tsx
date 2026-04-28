import { useEffect, useRef } from "react";
import { useEditor } from "@/store/editor";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2 } from "lucide-react";

export function Console() {
  const messages = useEditor((s) => s.consoleMessages);
  const clear = useEditor((s) => s.clearConsole);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="flex flex-col h-full bg-card/40">
      <div className="px-3 py-1.5 border-b border-border flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          Console <span className="text-muted-foreground/70">({messages.length})</span>
        </span>
        <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={clear}>
          <Trash2 className="size-3 mr-1" /> Clear
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div ref={scrollRef} className="p-2 space-y-0.5 font-mono text-xs">
          {messages.length === 0 && (
            <p className="text-muted-foreground/60 p-2">No messages — script `Debug.Log()` and engine events appear here.</p>
          )}
          {messages.map((m) => {
            const colorClass =
              m.level === "error"
                ? "text-destructive"
                : m.level === "warn"
                  ? "text-amber-400"
                  : m.level === "info"
                    ? "text-accent"
                    : "text-foreground/80";
            return (
              <div key={m.id} className={`flex gap-2 ${colorClass}`}>
                <span className="text-muted-foreground/60 shrink-0">
                  {new Date(m.ts).toLocaleTimeString([], { hour12: false })}
                </span>
                <span className="text-muted-foreground/60 uppercase text-[10px] mt-px shrink-0 w-10">
                  {m.level}
                </span>
                <span className="break-all whitespace-pre-wrap">{m.text}</span>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
