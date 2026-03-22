import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

export function useAppShellPanels() {
  const [aboutOpen, setAboutOpen] = useState(false);
  const [logsOpening, setLogsOpening] = useState(false);
  const [logsPath, setLogsPath] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (!aboutOpen || logsPath) {
      return;
    }
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
    if (logsOpening) {
      return;
    }
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
        typeof err === "string" && err.length > 0 ? err : `Failed to open logs folder${hint}`;
      toast.error(message);
    } finally {
      setLogsOpening(false);
    }
  };

  return {
    aboutOpen,
    handleOpenLogs,
    logsOpening,
    logsPath,
    setAboutOpen,
    setSettingsOpen,
    settingsOpen,
  };
}
