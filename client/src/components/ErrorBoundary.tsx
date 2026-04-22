/**
 * ErrorBoundary.tsx
 *
 * React class-based error boundary that catches render-phase errors and
 * displays a graceful "Something went wrong" card instead of a blank page.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <MyPage />
 *   </ErrorBoundary>
 *
 *   // With page name for better error messages:
 *   <ErrorBoundary pageName="Trading Dashboard">
 *     <Trade />
 *   </ErrorBoundary>
 *
 *   // HOC style:
 *   export default withErrorBoundary(MyPage, "My Page");
 */

import { cn } from "@/lib/utils";
import { AlertTriangle, Home, RefreshCw, RotateCcw } from "lucide-react";
import React, { Component, ErrorInfo, ReactNode } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  pageName?: string;
  /** Called when an error is caught — useful for logging to Sentry etc. */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

// ─── Error Boundary Class ─────────────────────────────────────────────────────

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ errorInfo: info });
    this.props.onError?.(error, info);
    if (import.meta.env.DEV) {
      console.error("[ErrorBoundary] Caught error:", error, info);
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const { pageName, } = this.props;
      const { error } = this.state;

      return (
        <div className="flex items-center justify-center min-h-[400px] p-8 bg-background">
          <div className="flex flex-col items-center w-full max-w-md p-8 rounded-xl border border-destructive/30 bg-destructive/5 text-center space-y-4">
            {/* Icon */}
            <div className="h-14 w-14 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertTriangle size={28} className="text-destructive" />
            </div>

            {/* Heading */}
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-foreground">
                {pageName ? `${pageName} failed to load` : "Something went wrong"}
              </h2>
              <p className="text-sm text-muted-foreground">
                An unexpected error occurred while rendering this page. Your data
                is safe — this is a display issue only.
              </p>
            </div>

            {/* Error detail */}
            {error && (
              <details className="text-left w-full">
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
                  Error details
                </summary>
                <pre
                  className={cn(
                    "mt-2 text-xs bg-muted/50 rounded-md p-3 overflow-auto max-h-32",
                    "text-destructive/80 whitespace-pre-wrap break-all"
                  )}
                >
                  {error.stack ?? error.message}
                </pre>
              </details>
            )}

            {/* Actions */}
            <div className="flex gap-3 justify-center pt-2">
              <button
                onClick={this.handleReset}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-sm",
                  "border border-border bg-background hover:bg-muted transition-colors"
                )}
              >
                <RefreshCw size={14} />
                Try again
              </button>
              <button
                onClick={() => window.location.reload()}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-sm",
                  "border border-border bg-background hover:bg-muted transition-colors"
                )}
              >
                <RotateCcw size={14} />
                Reload page
              </button>
              <button
                onClick={() => (window.location.href = "/")}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-sm",
                  "bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                )}
              >
                <Home size={14} />
                Go home
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// ─── HOC helper ──────────────────────────────────────────────────────────────

/**
 * Wrap a page component with an ErrorBoundary.
 * Usage: export default withErrorBoundary(MyPage, "My Page");
 */
export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  pageName?: string
): React.ComponentType<P> {
  const displayName =
    pageName ?? WrappedComponent.displayName ?? WrappedComponent.name ?? "Page";

  function WithErrorBoundaryWrapper(props: P) {
    return (
      <ErrorBoundary pageName={displayName}>
        <WrappedComponent {...props} />
      </ErrorBoundary>
    );
  }

  WithErrorBoundaryWrapper.displayName = `withErrorBoundary(${displayName})`;
  return WithErrorBoundaryWrapper;
}

export default ErrorBoundary;
