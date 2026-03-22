import { Laptop, Moon, Sun, X } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
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
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import { type Settings } from "../types/domain";

type Props = {
  autoDownloadIndex: number;
  autoDownloadLabel: string;
  autoDownloadOptions: number[];
  formatBytes: (value: number) => string;
  open: boolean;
  settings: Settings;
  updateAutoDownloadMaxBytes: (value: number) => void;
  updateAutoInstallUpdates: (value: boolean) => void;
  updateDownloadDir: (value: string) => void;
  updateSizeUnit: (value: "jedec" | "iec") => void;
  updateTheme: (value: "light" | "dark" | "system") => void;
  onClose: () => void;
};

export function SettingsModal({
  autoDownloadIndex,
  autoDownloadLabel,
  autoDownloadOptions,
  formatBytes,
  open: isOpen,
  settings,
  updateAutoDownloadMaxBytes,
  updateAutoInstallUpdates,
  updateDownloadDir,
  updateSizeUnit,
  updateTheme,
  onClose,
}: Props) {
  async function browseDownloadDir() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select download folder",
    });
    if (!selected) {
      return;
    }
    updateDownloadDir(selected as string);
  }

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-50 bg-slate-900/40 transition-opacity",
          isOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
      />
      <section
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background shadow-xl transition",
          isOpen ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0",
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
            onClick={onClose}
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
              <label className="text-sm font-medium text-foreground">Auto-download max size</label>
              <span className="text-sm font-medium text-foreground">{autoDownloadLabel}</span>
            </div>
            <Slider
              value={[autoDownloadIndex]}
              min={0}
              max={autoDownloadOptions.length - 1}
              step={1}
              onValueChange={([value]) => {
                const clamped = Math.max(0, Math.min(autoDownloadOptions.length - 1, value));
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
              onValueChange={(value) => updateTheme(value as "light" | "dark" | "system")}
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
    </>
  );
}
