import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { PulseInline } from "./PulseLogo";

const LINKS = [
  { to: "/lab", label: "Lab" },
  { to: "/anomalies", label: "Anomalies" },
  { to: "/model-card", label: "Model card" },
  { to: "/app", label: "Chat" },
];

/** The header and frame shared by the public tool pages. */
const SitePage = ({ children }: { children: ReactNode }) => (
  <div className="min-h-svh">
    <header className="container mx-auto px-4 min-h-16 py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <Link to="/" aria-label="Pulse home">
        <PulseInline height={28} />
      </Link>
      <nav aria-label="Main" className="flex items-center gap-4 text-sm">
        {LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) => (isActive ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground transition-colors")}
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
    </header>
    <main className="container mx-auto px-4 max-w-6xl pb-16">{children}</main>
    <footer className="container mx-auto px-4 max-w-6xl pb-8 text-sm text-muted-foreground">Educational, not financial advice.</footer>
  </div>
);

export default SitePage;
