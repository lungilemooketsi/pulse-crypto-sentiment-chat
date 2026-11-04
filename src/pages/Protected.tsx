import type { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth";
import { RequireAuth } from "@/components/AuthGate";

// Everything behind sign-in, split from the landing page so Firebase only loads on these routes.
const Protected = ({ children }: { children: ReactNode }) => (
  <AuthProvider>
    <RequireAuth>{children}</RequireAuth>
  </AuthProvider>
);

export default Protected;
