import { useMemo } from "react";
import { Outlet } from "react-router-dom";
import packageJson from "../../package.json";
import { useAppStore } from "../store/appStore";
import { TopNav } from "./TopNav";
import { AboutDrawer } from "./AboutDrawer";
import { SettingsModal } from "./SettingsModal";
import { formatBytes } from "../lib/formatters";
import { useAppShellPanels } from "../hooks/useAppShellPanels";

export function AppShell() {
  const {
    aboutOpen,
    handleOpenLogs,
    logsOpening,
    logsPath,
    setAboutOpen,
    setSettingsOpen,
    settingsOpen,
  } = useAppShellPanels();
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
    return formatBytes(value, settings.sizeUnit);
  }, [autoDownloadIndex, autoDownloadOptions, settings.sizeUnit]);

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-foreground">
      <TopNav onOpenSettings={() => setSettingsOpen(true)} />

      <main className="mx-auto w-full max-w-5xl flex-1 p-6 md:p-10">
        <Outlet />
      </main>

      <AboutDrawer
        open={aboutOpen}
        version={packageJson.version}
        logsPath={logsPath}
        logsOpening={logsOpening}
        onOpenLogs={() => {
          void handleOpenLogs();
        }}
        onClose={() => setAboutOpen(false)}
        onToggle={() => setAboutOpen((prev) => !prev)}
      />
      <SettingsModal
        open={settingsOpen}
        settings={settings}
        autoDownloadOptions={autoDownloadOptions}
        autoDownloadIndex={autoDownloadIndex}
        autoDownloadLabel={autoDownloadLabel}
        formatBytes={(value) => formatBytes(value, settings.sizeUnit)}
        updateDownloadDir={updateDownloadDir}
        updateAutoDownloadMaxBytes={updateAutoDownloadMaxBytes}
        updateSizeUnit={updateSizeUnit}
        updateTheme={updateTheme}
        updateAutoInstallUpdates={updateAutoInstallUpdates}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
