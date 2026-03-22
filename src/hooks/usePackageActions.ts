import { useCallback, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openPath } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { type Package, type Settings } from "../types/domain";

type PackageCreateResponse = {
  sessionId: string;
  packageId: string;
  ticket: string;
};

type PackageDownloadResponse = {
  sessionId: string;
  packageId: string;
};

type Args = {
  packageData: Package;
  settings: Settings;
  attachTicketToPackage: (payload: {
    packageId: string;
    sessionId: string;
    backendPackageId: string;
    ticket: string;
  }) => void;
  attachReceiveSession: (payload: { packageId: string; sessionId: string }) => void;
  markCancelledBySession: (sessionId: string) => void;
};

export function usePackageActions({
  packageData,
  settings,
  attachTicketToPackage,
  attachReceiveSession,
  markCancelledBySession,
}: Args) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isGeneratingTicket, setIsGeneratingTicket] = useState(false);

  const copyTicket = useCallback(
    async (overrideTicket?: string) => {
      const ticketToCopy = overrideTicket ?? packageData.ticket;
      if (!ticketToCopy) {
        return;
      }

      try {
        await writeText(ticketToCopy);
        setError(null);
        toast.success("Copied!");
      } catch (pluginError) {
        try {
          await navigator.clipboard.writeText(ticketToCopy);
          setError(null);
          toast.success("Copied!");
        } catch (fallbackError) {
          setError(`Copy failed: ${String(pluginError)} | ${String(fallbackError)}`);
        }
      }
    },
    [packageData.ticket],
  );

  const generateTicket = useCallback(async () => {
    if (!packageData.sourcePaths?.length) {
      setError("No source files found for this package.");
      return;
    }

    setIsGeneratingTicket(true);
    setBusy(true);
    setError(null);

    try {
      const response = await invoke<PackageCreateResponse>("package_create", {
        files: packageData.sourcePaths,
        roots: packageData.selectedRoots ?? [],
      });

      attachTicketToPackage({
        packageId: packageData.id,
        sessionId: response.sessionId,
        backendPackageId: response.packageId,
        ticket: response.ticket,
      });
      await copyTicket(response.ticket);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
      setIsGeneratingTicket(false);
    }
  }, [attachTicketToPackage, copyTicket, packageData.id, packageData.selectedRoots, packageData.sourcePaths]);

  const startDownload = useCallback(async () => {
    if (!packageData.ticket) {
      setError("No ticket found on this package.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await invoke<PackageDownloadResponse>("package_download", {
        ticket: packageData.ticket,
        packageId: packageData.backendPackageId ?? packageData.id,
        downloadDir: settings.downloadDir,
      });

      attachReceiveSession({
        packageId: packageData.id,
        sessionId: result.sessionId,
      });
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }, [attachReceiveSession, packageData.backendPackageId, packageData.id, packageData.ticket, settings.downloadDir]);

  const cancelDownload = useCallback(async () => {
    if (!packageData.sessionId) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await invoke("transfer_cancel", {
        sessionId: packageData.sessionId,
      });
      markCancelledBySession(packageData.sessionId);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }, [markCancelledBySession, packageData.sessionId]);

  const openDownloadFolder = useCallback(async () => {
    const targetDir = packageData.downloadDir ?? settings.downloadDir;
    if (!targetDir) {
      setError("No download folder available.");
      return;
    }

    try {
      await openPath(targetDir);
    } catch (cause) {
      setError(`Failed to open folder: ${String(cause)}`);
    }
  }, [packageData.downloadDir, settings.downloadDir]);

  const maskedTicket = useMemo(
    () => (packageData.ticket ? `${packageData.ticket.slice(0, 12)}...` : ""),
    [packageData.ticket],
  );

  return {
    busy,
    cancelDownload,
    copyTicket,
    error,
    generateTicket,
    isGeneratingTicket,
    maskedTicket,
    openDownloadFolder,
    setError,
    startDownload,
  };
}
