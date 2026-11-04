import { Component, type ErrorInfo, type ReactNode } from "react";

const RELOAD_KEY = "pulse-reloaded-at";

// After a deploy, an open tab can ask for code files that no longer exist.
const isStaleCode = (error: Error) => /dynamically imported module|importing a module|failed to fetch|mime type/i.test(error.message);

function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

/** Keeps a page error from blanking the screen: stale code reloads itself, anything else shows a way back. */
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Page error:", error, info.componentStack);
    if (isStaleCode(error)) reloadOnce();
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="min-h-svh flex flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="font-display text-2xl font-bold tracking-tight">This page hit a problem</h1>
        <p className="text-muted-foreground">Reloading usually fixes it.</p>
        <div className="flex gap-4">
          <button type="button" onClick={() => window.location.reload()} className="underline underline-offset-4 decoration-brand">
            Reload
          </button>
          <a href="/" className="underline underline-offset-4 decoration-muted-foreground">
            Return to Home
          </a>
        </div>
      </main>
    );
  }
}

export default ErrorBoundary;
