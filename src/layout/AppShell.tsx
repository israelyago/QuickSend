import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { ExternalLink, Laptop, Moon, Settings, Sun, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { open } from "@tauri-apps/plugin-dialog";
import { cn } from "../lib/utils";
import { Button } from "../components/ui/button";
import { Field, FieldLabel } from "../components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Slider } from "../components/ui/slider";
import { Switch } from "../components/ui/switch";
import packageJson from "../../package.json";
import { useAppStore } from "../store/appStore";
import { filesize } from "filesize";

export function AppShell() {
  const [aboutOpen, setAboutOpen] = useState(false);
  const [logsOpening, setLogsOpening] = useState(false);
  const [logsPath, setLogsPath] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settings = useAppStore((state) => state.settings);
  const updateDownloadDir = useAppStore((state) => state.updateDownloadDir);
  const updateTheme = useAppStore((state) => state.updateTheme);
  const updateAutoDownloadMaxBytes = useAppStore(
    (state) => state.updateAutoDownloadMaxBytes,
  );
  const updateAutoInstallUpdates = useAppStore(
    (state) => state.updateAutoInstallUpdates,
  );
  const updateSizeUnit = useAppStore((state) => state.updateSizeUnit);

  const formatBytes = (value: number) =>
    filesize(value, { standard: settings.sizeUnit, round: 1, pad: true }) as string;

  const autoDownloadOptions = useMemo(() => {
    const mb256 = 256 * 1024 * 1024;
    const gb1 = 1024 * 1024 * 1024;
    const gb5 = 5 * 1024 * 1024 * 1024;
    const gb10 = 10 * 1024 * 1024 * 1024;
    return [0, mb256, gb1, gb5, gb10, -1];
  }, []);

  const autoDownloadIndex = useMemo(() => {
    const current = settings.autoDownloadMaxBytes;
    if (!Number.isFinite(current)) {
      return 0;
    }
    if (current < 0) {
      return autoDownloadOptions.length - 1;
    }
    if (current === 0) {
      return 0;
    }
    let bestIndex = 1;
    let bestDiff = Math.abs(current - autoDownloadOptions[1]);
    autoDownloadOptions.slice(1, -1).forEach((value, offset) => {
      const index = offset + 1;
      const diff = Math.abs(current - value);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIndex = index;
      }
    });
    return bestIndex;
  }, [autoDownloadOptions, settings.autoDownloadMaxBytes]);

  const autoDownloadLabel = useMemo(() => {
    const value = autoDownloadOptions[autoDownloadIndex];
    if (value === 0) {
      return "Never";
    }
    if (value < 0) {
      return "Unlimited";
    }
    return formatBytes(value);
  }, [autoDownloadIndex, autoDownloadOptions, formatBytes]);

  useEffect(() => {
    if (!aboutOpen || logsPath) return;
    let active = true;
    invoke<string>("logs_dir")
      .then((path) => {
        if (active) {
          setLogsPath(path);
        }
      })
      .catch((err) => {
        console.error("Failed to resolve logs folder", err);
        toast.error("Failed to resolve logs folder");
      });
    return () => {
      active = false;
    };
  }, [aboutOpen, logsPath]);

  const handleOpenLogs = async () => {
    if (logsOpening) return;
    setLogsOpening(true);
    try {
      const openedPath = await invoke<string>("open_logs_dir");
      if (!logsPath) {
        setLogsPath(openedPath);
      }
    } catch (err) {
      console.error("Failed to open logs folder", err);
      const hint = logsPath ? ` (${logsPath})` : "";
      const message =
        typeof err === "string" && err.length > 0
          ? err
          : `Failed to open logs folder${hint}`;
      toast.error(message);
    } finally {
      setLogsOpening(false);
    }
  };

  const browseDownloadDir = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select download folder",
    });
    if (!selected) {
      return;
    }
    updateDownloadDir(selected as string);
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-foreground">
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
            onClick={() => setSettingsOpen(true)}
          >
            <Settings className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 p-6 md:p-10">
        <Outlet />
      </main>

      <footer className="pb-4 text-center text-xs">
        <button
          type="button"
          className="cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setAboutOpen((prev) => !prev)}
        >
          v{packageJson.version}
        </button>
      </footer>

      <div
        className={cn(
          "fixed inset-0 z-40 bg-slate-900/30 transition-opacity",
          aboutOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => setAboutOpen(false)}
      />
      <section
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 translate-y-full border-t border-border bg-card shadow-lg transition-transform duration-300",
          aboutOpen ? "translate-y-0" : "pointer-events-none",
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
            <h2 className="text-2xl font-semibold text-foreground">
              QuickSend
            </h2>
          </div>
          <div className="grid gap-4 text-sm text-muted-foreground sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Version
              </p>
              <p className="text-base font-medium text-foreground">
                v{packageJson.version}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Logs Folder
              </p>
              <p className="truncate text-sm text-foreground">
                {logsPath ?? "Resolving..."}
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              variant="outline"
              className="gap-2"
              onClick={handleOpenLogs}
              disabled={logsOpening}
            >
              <ExternalLink className="h-4 w-4" />
              Logs
            </Button>
          </div>
        </div>
      </section>

      <div
        className={cn(
          "fixed inset-0 z-50 bg-slate-900/40 transition-opacity",
          settingsOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => setSettingsOpen(false)}
      />
      <section
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background shadow-xl transition",
          settingsOpen ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0",
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <div className="flex items-start justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Settings</h2>
            <p className="text-sm text-muted-foreground">Changes save automatically.</p>
          </div>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:text-foreground"
            aria-label="Close settings"
            onClick={() => setSettingsOpen(false)}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="space-y-6 px-6 py-5">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground" htmlFor="download-dir">
              Default download folder
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <input
                id="download-dir"
                className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                value={settings.downloadDir}
                onChange={(event) => updateDownloadDir(event.target.value)}
              />
              <Button variant="outline" type="button" onClick={browseDownloadDir}>
                Browse
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-foreground">
                Auto-download max size
              </label>
              <span className="text-sm font-medium text-foreground">
                {autoDownloadLabel}
              </span>
            </div>
            <Slider
              value={[autoDownloadIndex]}
              min={0}
              max={autoDownloadOptions.length - 1}
              step={1}
              onValueChange={([value]) => {
                const clamped = Math.max(
                  0,
                  Math.min(autoDownloadOptions.length - 1, value),
                );
                updateAutoDownloadMaxBytes(autoDownloadOptions[clamped]);
              }}
            />
            <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
              <span>Never</span>
              <span>{formatBytes(autoDownloadOptions[1])}</span>
              <span>{formatBytes(autoDownloadOptions[2])}</span>
              <span>{formatBytes(autoDownloadOptions[3])}</span>
              <span>{formatBytes(autoDownloadOptions[4])}</span>
              <span>Unlimited</span>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Size unit</label>
            <Select
              value={settings.sizeUnit}
              onValueChange={(value) => updateSizeUnit(value as "jedec" | "iec")}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select unit" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="jedec">MB (decimal)</SelectItem>
                <SelectItem value="iec">MiB (binary)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Theme</label>
            <Select
              value={settings.theme}
              onValueChange={(value) =>
                updateTheme(value as "light" | "dark" | "system")
              }
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Select theme" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">
                  <span className="flex items-center gap-2">
                    <Laptop className="h-4 w-4" aria-hidden="true" />
                    System
                  </span>
                </SelectItem>
                <SelectItem value="light">
                  <span className="flex items-center gap-2">
                    <Sun className="h-4 w-4" aria-hidden="true" />
                    Light
                  </span>
                </SelectItem>
                <SelectItem value="dark">
                  <span className="flex items-center gap-2">
                    <Moon className="h-4 w-4" aria-hidden="true" />
                    Dark
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Field>
              <FieldLabel
                htmlFor="auto-install-updates"
                className="flex items-start justify-between gap-4 rounded-md border border-border p-3 cursor-pointer"
              >
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">Install updates automatically</p>
                  <p className="text-xs font-normal text-muted-foreground">
                    Checks for a new version on startup and installs it in the background.
                  </p>
                </div>
                <Switch
                  id="auto-install-updates"
                  checked={settings.autoInstallUpdates}
                  onCheckedChange={updateAutoInstallUpdates}
                  aria-label="Install updates automatically"
                />
              </FieldLabel>
            </Field>
          </div>
        </div>
      </section>
    </div>
  );
}
