import { Toaster } from "@/components/ui/sonner";
import ErrorBoundary from "@/components/ErrorBoundary";
import RouteMeta from "@/components/RouteMeta";
import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Landing from "./pages/Landing";
import ModelCard from "./pages/ModelCard";
import NotFound from "./pages/NotFound";

const Protected = lazy(() => import("./pages/Protected"));
const Index = lazy(() => import("./pages/Index"));
const Lab = lazy(() => import("./pages/Lab"));
const Anomalies = lazy(() => import("./pages/Anomalies"));

// Shown while the /app chunk and Firebase load.
const AppLoading = () => (
  <div className="min-h-svh flex items-center justify-center" role="status" aria-label="Loading Pulse">
    <span className="bar-loader" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </span>
  </div>
);

const App = () => (
  <>
    <Toaster />
      <BrowserRouter>
        <RouteMeta />
        <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/model-card" element={<ModelCard />} />
          <Route
            path="/lab"
            element={
              <Suspense fallback={<AppLoading />}>
                <Protected>
                  <Lab />
                </Protected>
              </Suspense>
            }
          />
          <Route
            path="/anomalies"
            element={
              <Suspense fallback={<AppLoading />}>
                <Protected>
                  <Anomalies />
                </Protected>
              </Suspense>
            }
          />
          <Route
            path="/app"
            element={
              <Suspense fallback={<AppLoading />}>
                <Protected>
                  <Index />
                </Protected>
              </Suspense>
            }
          />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
        </ErrorBoundary>
      </BrowserRouter>
  </>
);

export default App;
