import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
  /** Bumped on retry — used as a key on children to force a fresh mount
   *  so the broken subtree doesn't keep throwing on re-render. */
  retryToken: number;
}

interface Props {
  children: ReactNode;
}

/** App-level error boundary.
 *
 *  Wraps the entire EditorShell so a crash in any single panel
 *  (Inspector, Hierarchy, BottomPanel, scripts, etc.) shows a recovery
 *  card instead of a white screen. The user keeps two ways out:
 *
 *    1. **Try again** — bumps a key on children so React remounts the
 *       whole shell. The Zustand store survives, so the scene + any
 *       in-flight localStorage draft are preserved.
 *    2. **Reload editor** — full page reload. The localStorage draft
 *       written by `useEditorDraftMirror` is then restored by the
 *       store's `loadScene` action on next open.
 *
 *  Either way, the user's work survives a panel crash.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, retryToken: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error("[GameForge] uncaught render error:", error, info.componentStack);
  }

  private handleRetry = () => {
    this.setState((s) => ({ error: null, retryToken: s.retryToken + 1 }));
  };

  private handleReload = () => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          className="h-screen w-screen flex items-center justify-center bg-background text-foreground p-6"
          data-testid="app-error-boundary"
        >
          <div className="max-w-lg w-full rounded-xl border border-destructive/40 bg-card shadow-2xl p-6">
            <div className="text-[11px] font-heading uppercase tracking-[0.18em] text-destructive mb-2">
              Editor Crashed
            </div>
            <h2 className="text-xl font-heading mb-2">Something broke a panel.</h2>
            <p className="text-sm text-muted-foreground mb-3">
              Your scene is safe — unsaved changes were mirrored to local
              storage and will be restored automatically. Try the panel
              again, or reload the editor.
            </p>
            <pre
              className="text-[11px] font-mono bg-muted/40 border border-card-border rounded p-2 max-h-40 overflow-auto whitespace-pre-wrap break-words mb-4"
              data-testid="app-error-message"
            >
              {this.state.error.message}
              {this.state.error.stack ? `\n\n${this.state.error.stack.split("\n").slice(0, 6).join("\n")}` : ""}
            </pre>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={this.handleRetry}
                className="px-3 py-1.5 rounded-md border border-card-border hover:border-accent hover:bg-accent/5 text-sm"
                data-testid="app-error-retry"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={this.handleReload}
                className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 text-sm"
                data-testid="app-error-reload"
              >
                Reload editor
              </button>
            </div>
          </div>
        </div>
      );
    }
    // `key` forces a fresh mount on retry so a sticky bad render state
    // can't immediately re-throw on the same instance.
    return <div key={this.state.retryToken} className="contents">{this.props.children}</div>;
  }
}
