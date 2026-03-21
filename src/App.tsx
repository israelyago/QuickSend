import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { check } from "@tauri-apps/plugin-updater";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./layout/AppShell";
import { PackagePage } from "./pages/PackagePage";
import { ReceivePage } from "./pages/ReceivePage";
import { SendPage } from "./pages/SendPage";
import { useAppStore } from "./store/appStore";
import { type Settings } from "./types/domain";
import { Toaster } from "sonner";

type TransferPeerConnectedEvent = {
  sessionId: string;
  packageId: string;
  peerId: string;
};

type TransferProgressEvent = {
  sessionId: string;
  packageId: string;
  transferredBytes: number;
  totalBytes: number;
  fileName?: string;
};

type TransferCompletedEvent = {
  sessionId: string;
  packageId: string;
  downloadDir?: string;
};

type TransferErrorEvent = {
  sessionId: string;
  packageId?: string;
  code: string;
  message: string;
};

function normalizeLoadedSettings(
  raw: Partial<Settings> | null | undefined,
  fallback: Settings,
): Settings {
  if (!raw) {
    return fallback;
  }

  const next: Settings = { ...fallback };

  if (typeof raw.downloadDir === "string" && raw.downloadDir.trim().length > 0) {
    next.downloadDir = raw.downloadDir;
  }

  if (raw.theme === "light" || raw.theme === "dark" || raw.theme === "system") {
    next.theme = raw.theme;
  }

  if (typeof raw.autoDownloadMaxBytes === "number" && Number.isFinite(raw.autoDownloadMaxBytes)) {
    next.autoDownloadMaxBytes = raw.autoDownloadMaxBytes < 0 ? -1 : Math.max(0, raw.autoDownloadMaxBytes);
  }
  if (typeof raw.autoInstallUpdates === "boolean") {
    next.autoInstallUpdates = raw.autoInstallUpdates;
  }

  if (raw.sizeUnit === "jedec" || raw.sizeUnit === "iec") {
    next.sizeUnit = raw.sizeUnit;
  }

  return next;
}

function App() {
  const settings = useAppStore((state) => state.settings);
  const selectedTheme = useAppStore((state) => state.settings.theme);
  const applyPeerConnectedEvent = useAppStore((state) => state.applyPeerConnectedEvent);
  const applyProgressEvent = useAppStore((state) => state.applyProgressEvent);
  const applyCompletedEvent = useAppStore((state) => state.applyCompletedEvent);
  const applyErrorEvent = useAppStore((state) => state.applyErrorEvent);
  const settingsReady = useRef(false);
  const updateCheckAttempted = useRef(false);

  useEffect(() => {
    let active = true;

    const loadSettings = async () => {
      try {
        const loaded = await invoke<Partial<Settings> | null>("settings_load");
        if (!active) {
          return;
        }
        useAppStore.setState((state) => ({
          settings: normalizeLoadedSettings(loaded, state.settings),
        }));
      } catch (err) {
        console.error("Failed to load settings", err);
      } finally {
        if (active) {
          settingsReady.current = true;
        }
      }
    };

    void loadSettings();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!settingsReady.current) {
      return;
    }

    const timer = window.setTimeout(() => {
      void invoke("settings_save", { settings }).catch((err) => {
        console.error("Failed to save settings", err);
      });
    }, 200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [settings]);

  useEffect(() => {
    if (!settingsReady.current || updateCheckAttempted.current) {
      return;
    }
    if (!settings.autoInstallUpdates) {
      return;
    }

    updateCheckAttempted.current = true;
    void (async () => {
      try {
        const update = await check();
        if (update) {
          await update.downloadAndInstall();
        }
      } catch (err) {
        console.error("Auto-update failed", err);
      }
    })();
  }, [settings.autoInstallUpdates]);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const applyTheme = () => {
      const resolved =
        selectedTheme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : selectedTheme;
      root.classList.toggle("dark", resolved === "dark");
      root.style.colorScheme = resolved;
    };

    applyTheme();

    if (selectedTheme !== "system") {
      return;
    }

    const onSystemThemeChange = () => {
      applyTheme();
    };
    media.addEventListener("change", onSystemThemeChange);
    return () => {
      media.removeEventListener("change", onSystemThemeChange);
    };
  }, [selectedTheme]);

  useEffect(() => {
    let disposePeer = () => {};
    let disposeProgress = () => {};
    let disposeCompleted = () => {};
    let disposeError = () => {};

    const setup = async () => {
      const unlistenPeer = await listen("transfer:peer-connected", (event) => {
        applyPeerConnectedEvent(event.payload as TransferPeerConnectedEvent);
      });
      const unlistenProgress = await listen("transfer:progress", (event) => {
        applyProgressEvent(event.payload as TransferProgressEvent);
      });
      const unlistenCompleted = await listen("transfer:completed", (event) => {
        applyCompletedEvent(event.payload as TransferCompletedEvent);
      });
      const unlistenError = await listen("transfer:error", (event) => {
        applyErrorEvent(event.payload as TransferErrorEvent);
      });
      disposePeer = unlistenPeer;
      disposeProgress = unlistenProgress;
      disposeCompleted = unlistenCompleted;
      disposeError = unlistenError;
    };

    void setup();

    return () => {
      disposePeer();
      disposeProgress();
      disposeCompleted();
      disposeError();
    };
  }, [applyCompletedEvent, applyErrorEvent, applyPeerConnectedEvent, applyProgressEvent]);

  return (
    <>
      <Toaster richColors position="bottom-center" />
      <HashRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<Navigate to="/send" replace />} />
            <Route path="/send" element={<SendPage />} />
            <Route path="/receive" element={<ReceivePage />} />
            <Route path="/package/:id" element={<PackagePage />} />
            <Route path="*" element={<Navigate to="/send" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </>
  );
}

export default App;
