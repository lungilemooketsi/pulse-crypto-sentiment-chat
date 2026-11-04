import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { PulseMark } from "@/components/PulseLogo";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 px-4 text-center">
      <PulseMark className="h-24 w-auto text-brand" />
      <div className="space-y-3">
        <h1 className="font-display text-2xl font-bold tracking-tight">404</h1>
        <p className="text-xl text-muted-foreground">Oops! Page not found</p>
      </div>
      <a
        href="/"
        className="text-lg text-foreground underline underline-offset-4 decoration-brand hover:decoration-2"
      >
        Return to Home
      </a>
    </main>
  );
};

export default NotFound;
