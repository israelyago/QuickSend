import { ExternalLink } from "lucide-react";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";

type Props = {
  logsOpening: boolean;
  logsPath: string | null;
  open: boolean;
  version: string;
  onClose: () => void;
  onOpenLogs: () => void;
  onToggle: () => void;
};

export function AboutDrawer({
  logsOpening,
  logsPath,
  open,
  version,
  onClose,
  onOpenLogs,
  onToggle,
}: Props) {
  return (
    <>
      <footer className="pb-4 text-center text-xs">
        <button
          type="button"
          className="cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
          onClick={onToggle}
        >
          v{version}
        </button>
      </footer>

      <div
        className={cn(
          "fixed inset-0 z-40 bg-slate-900/30 transition-opacity",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
      />
      <section
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 translate-y-full border-t border-border bg-card shadow-lg transition-transform duration-300",
          open ? "translate-y-0" : "pointer-events-none",
        )}
        role="dialog"
        aria-modal="true"
        aria-label="About QuickSend"
      >
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              About
            </p>
            <h2 className="text-2xl font-semibold text-foreground">QuickSend</h2>
          </div>
          <div className="grid gap-4 text-sm text-muted-foreground sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Version</p>
              <p className="text-base font-medium text-foreground">v{version}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Logs Folder</p>
              <p className="truncate text-sm text-foreground">{logsPath ?? "Resolving..."}</p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button variant="outline" className="gap-2" onClick={onOpenLogs} disabled={logsOpening}>
              <ExternalLink className="h-4 w-4" />
              Logs
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
