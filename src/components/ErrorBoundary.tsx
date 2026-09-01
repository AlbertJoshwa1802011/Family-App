import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./ui/Button";

interface Props {
  children: ReactNode;
  /** Optional label shown in the recovery card. */
  label?: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches render crashes so a single page bug can't wipe the whole shell to
 * a blank white screen (the failure mode users reported after creating an event).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6 py-12 text-center">
          <div className="max-w-sm space-y-2">
            <h1 className="text-lg font-semibold text-fg">
              {this.props.label ?? "Something went wrong"}
            </h1>
            <p className="text-sm text-fg-muted">
              The screen crashed while rendering. Your data is safe — try going
              back or reloading.
            </p>
            <p className="break-words font-mono text-[11px] text-fg-subtle">
              {this.state.error.message}
            </p>
          </div>
          <div className="flex w-full max-w-xs flex-col gap-2">
            <Button
              fullWidth
              onClick={() => {
                this.setState({ error: null });
                window.location.assign("/");
              }}
            >
              Go home
            </Button>
            <Button
              fullWidth
              variant="secondary"
              onClick={() => window.location.reload()}
            >
              Reload
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
