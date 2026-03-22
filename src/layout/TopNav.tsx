import { NavLink } from "react-router-dom";
import { Settings } from "lucide-react";
import { cn } from "../lib/utils";

type Props = {
  onOpenSettings: () => void;
};

export function TopNav({ onOpenSettings }: Props) {
  return (
    <header className="border-b border-border bg-card">
      <div className="relative mx-auto flex max-w-5xl items-center justify-center px-6 py-4">
        <nav className="inline-flex rounded-md border border-border bg-muted p-1">
          {[
            { to: "/send", label: "Send" },
            { to: "/receive", label: "Receive" },
          ].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "rounded-md px-4 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button
          type="button"
          className="absolute right-6 inline-flex items-center justify-center text-muted-foreground transition hover:scale-110 hover:text-foreground"
          aria-label="Open settings"
          onClick={onOpenSettings}
        >
          <Settings className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
