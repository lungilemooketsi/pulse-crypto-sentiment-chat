import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { PulseLockup, PulseMark } from "@/components/PulseLogo";

const PUBLIC_ENV_VARS = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
  "VITE_API_URL",
];

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, configured } = useAuth();

  if (!configured) return <ConfigurationRequired />;
  if (loading) return <StatusScreen title="Checking your session..." />;
  if (!user) return <AuthGate />;
  return children;
}

function ConfigurationRequired() {
  return (
    <StatusScreen title="Firebase is not configured">
      <p className="text-sm text-muted-foreground">
        Copy <code className="text-foreground">.env.example</code> to <code className="text-foreground">.env</code> and
        set these public values before starting the app:
      </p>
      <ul className="text-sm text-left space-y-1 text-muted-foreground">
        {PUBLIC_ENV_VARS.map((name) => (
          <li key={name}>
            <code className="text-foreground">{name}</code>
          </li>
        ))}
      </ul>
    </StatusScreen>
  );
}

function AuthGate() {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState<"sign-in" | "sign-up">(
    searchParams.get("mode") === "sign-up" ? "sign-up" : "sign-in",
  );
  const carriedQuestion = searchParams.get("q");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "sign-up") {
        await signUpWithEmail(email.trim(), password);
      } else {
        await signInWithEmail(email.trim(), password);
      }
    } catch (caught) {
      setError(authErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const onGoogle = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await signInWithGoogle();
    } catch (caught) {
      setError(authErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <StatusScreen title={mode === "sign-up" ? "Create an account" : "Sign in to chat"}>
      {carriedQuestion && (
        <p className="text-sm text-muted-foreground">
          Pulse will answer <span className="text-foreground">“{carriedQuestion}”</span> as soon as you're in.
        </p>
      )}
      <Button type="button" className="w-full h-11" onClick={onGoogle} disabled={submitting}>
        Continue with Google
      </Button>
      <p className="text-sm text-muted-foreground">Or use your email</p>
      <form className="space-y-4" onSubmit={onSubmit}>
        <div className="space-y-2 text-left">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            disabled={submitting}
          />
        </div>
        <div className="space-y-2 text-left">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            disabled={submitting}
          />
        </div>
        {error && <p className="text-sm text-destructive text-left">{error}</p>}
        <Button
          type="submit"
          className="bar-cut w-full h-12 pt-1 bg-brand text-brand-foreground hover:bg-brand/90 active:translate-y-px transition-[background-color,transform]"
          disabled={submitting}
        >
          {mode === "sign-up" ? "Create account" : "Sign in"}
        </Button>
      </form>
      <button
        type="button"
        className="text-sm text-foreground underline underline-offset-4 decoration-muted-foreground hover:decoration-foreground"
        onClick={() => {
          setMode(mode === "sign-up" ? "sign-in" : "sign-up");
          setError(null);
        }}
      >
        {mode === "sign-up" ? "Already have an account? Sign in" : "Need an account? Create one"}
      </button>
    </StatusScreen>
  );
}

function StatusScreen({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main className="min-h-svh grid lg:grid-cols-2">
      <div className="relative hidden lg:block overflow-hidden bg-card" aria-hidden="true">
        <PulseMark className="absolute left-[14%] top-[16%] h-[112%] w-auto text-brand" />
      </div>
      <div className="flex flex-col items-center justify-center gap-8 px-4 py-12">
        <Link to="/" aria-label="Pulse home">
          <PulseLockup className="h-28 w-auto" />
        </Link>
        <div className="w-full max-w-md bg-card border p-8 space-y-6">
          <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
          {children}
        </div>
      </div>
    </main>
  );
}

function authErrorMessage(error: unknown): string {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
    return "Email or password is incorrect.";
  }
  if (code === "auth/email-already-in-use") return "An account with that email already exists.";
  if (code === "auth/weak-password") return "Use a password of at least 6 characters.";
  if (code === "auth/popup-closed-by-user") return "Google sign-in was closed before it finished.";
  if (code === "auth/invalid-email") return "Enter a valid email address.";
  if (error instanceof Error && error.message) return error.message;
  return "Sign-in failed. Try again.";
}
