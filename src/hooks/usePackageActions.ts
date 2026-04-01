import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openPath } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { type Package, type Settings } from "../types/domain";
import { buildReceiveLink } from "../lib/ticketLink";
import { useAppStore } from "../store/appStore";

type PackagePrepareStartResponse = {
  prepareSessionId: string;
  packageId: string;
};

type PackagePrepareFinalizeResponse = {
  sessionId: string;
  packageId: string;
  ticket: string;
};

type PackagePrepareAddFilesResponse = {
  ok: boolean;
  prepareSessionId: string;
  packageId: string;
};

type SendPrepareProgressEvent = {
  prepareSessionId: string;
  packageId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  summary: {
    totalFiles: number;
    completedFiles: number;
    failedFiles: number;
    cancelledFiles: number;
    processedBytes: number;
    totalBytes: number;
  };
  files: Array<{
    fileId: string;
    name: string;
    path: string;
    status: "queued" | "importing" | "verifying" | "completed" | "failed" | "cancelled";
    processedBytes: number;
    totalBytes: number;
    error?: string;
  }>;
  sequence: number;
  done: boolean;
  changedFileIds: string[];
};

type PackageDownloadResponse = {
  sessionId: string;
  packageId: string;
};

type CancelResponse = {
  ok: boolean;
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
  startPackagePrepare: (payload: { packageId: string; prepareSessionId: string }) => void;
  removeFileFromPackage: (payload: { packageId: string; fileId: string }) => void;
  markCancelledBySession: (sessionId: string) => void;
};

export function usePackageActions({
  packageData,
  settings,
  attachTicketToPackage,
  attachReceiveSession,
  startPackagePrepare,
  removeFileFromPackage,
  markCancelledBySession,
}: Args) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const enqueueingPathsRef = useRef<Set<string>>(new Set());
  const applyPrepareProgress = useAppStore((state) => state.applySendPrepareProgressEvent);

  const copyTicket = useCallback(
    async (overrideTicket?: string) => {
      const ticketToCopy = overrideTicket ?? packageData.ticket;
      if (!ticketToCopy) {
        return;
      }
      const receiveLink = buildReceiveLink(ticketToCopy);

      try {
        await writeText(receiveLink);
        setError(null);
        toast.success("Copied!");
      } catch (pluginError) {
        try {
          await navigator.clipboard.writeText(receiveLink);
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
    if (!packageData.prepareSessionId) {
      setError("Files are still being prepared. Please try again in a moment.");
      return;
    }

    // Capture the current busy state before deciding what to do
    const wasBusyBefore = busy;

    // We always want to be "busy" if we are in this flow
    setBusy(true);

    // If we weren't already showing the progress screen, just return here and show it.
    // This allows the user to see the "Prepared" state before they manually click to finalize.
    if (!wasBusyBefore) {
      return;
    }

    setError(null);

    try {
      const response = await invoke<PackagePrepareFinalizeResponse>("package_prepare_finalize", {
        prepareSessionId: packageData.prepareSessionId,
      });
      attachTicketToPackage({
        packageId: packageData.id,
        sessionId: response.sessionId,
        backendPackageId: response.packageId,
        ticket: response.ticket,
      });
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }, [
    attachTicketToPackage,
    copyTicket,
    packageData.id,
    packageData.prepareSessionId,
    packageData.sourcePaths,
    busy,
  ]);

  useEffect(() => {
    if (packageData.mode !== "send") {
      return;
    }
    if (!packageData.sourcePaths?.length) {
      return;
    }
    if (packageData.ticket) {
      return;
    }
    for (const file of packageData.files) {
      if (file.sourcePath && file.prepareStatus !== undefined) {
        enqueueingPathsRef.current.delete(file.sourcePath);
      }
    }

    const syncPrepare = async () => {
      if (!packageData.prepareSessionId) {
        const response = await invoke<PackagePrepareStartResponse>("package_prepare_start", {
          files: packageData.sourcePaths ?? [],
          roots: packageData.selectedRoots ?? [],
        });
        startPackagePrepare({
          packageId: packageData.id,
          prepareSessionId: response.prepareSessionId,
        });
        for (const path of packageData.sourcePaths ?? []) {
          enqueueingPathsRef.current.add(path);
        }
        const snapshot = await invoke<SendPrepareProgressEvent>("package_prepare_status", {
          prepareSessionId: response.prepareSessionId,
        });
        applyPrepareProgress(snapshot);
        return;
      }

      const pending = packageData.files
        .filter((file) => file.sourcePath)
        .filter(
          (file) =>
            file.prepareStatus === undefined &&
            !file.prepareBackendFileId &&
            !enqueueingPathsRef.current.has(file.sourcePath!),
        )
        .map((file) => file.sourcePath!) as string[];

      if (pending.length === 0) {
        return;
      }

      for (const path of pending) {
        enqueueingPathsRef.current.add(path);
      }
      await invoke<PackagePrepareAddFilesResponse>("package_prepare_add_files", {
        prepareSessionId: packageData.prepareSessionId,
        files: pending,
        roots: packageData.selectedRoots ?? [],
      });
      const snapshot = await invoke<SendPrepareProgressEvent>("package_prepare_status", {
        prepareSessionId: packageData.prepareSessionId,
      });
      applyPrepareProgress(snapshot);
    };

    void syncPrepare().catch((cause) => {
      setError(String(cause));
    });
  }, [
    packageData.files,
    packageData.id,
    packageData.mode,
    packageData.prepareSessionId,
    packageData.prepareStatus,
    packageData.selectedRoots,
    packageData.sourcePaths,
    packageData.ticket,
    applyPrepareProgress,
    startPackagePrepare,
  ]);

  useEffect(() => {
    if (busy && packageData.prepareStatus === "completed" && !packageData.ticket) {
      void generateTicket();
    }
  }, [busy, packageData.prepareStatus, packageData.ticket, generateTicket]);

  const startDownload = useCallback(async () => {
    if (!packageData.ticket) {
      setError("No ticket found on this package.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const configuredDownloadDir = settings.downloadDir.trim();
      const result = await invoke<PackageDownloadResponse>("package_download", {
        ticket: packageData.ticket,
        packageId: packageData.backendPackageId ?? packageData.id,
        downloadDir: configuredDownloadDir.length > 0 ? configuredDownloadDir : undefined,
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

  const removePreparingFile = useCallback(
    async (fileId: string, prepareBackendFileId?: string, sourcePath?: string) => {
      removeFileFromPackage({ packageId: packageData.id, fileId });
      if (!packageData.prepareSessionId) {
        return;
      }
      try {
        const response = await invoke<CancelResponse>("package_prepare_remove_file", {
          prepareSessionId: packageData.prepareSessionId,
          fileId: prepareBackendFileId,
          filePath: sourcePath,
        });
        if (!response.ok) {
          setError("Could not remove file from active preparation session.");
        }
      } catch (cause) {
        setError(String(cause));
      }
    },
    [packageData.id, packageData.prepareSessionId, removeFileFromPackage],
  );

  const cancelGenerateTicket = useCallback(() => {
    setBusy(false);
  }, []);

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

  const isGeneratingTicket = packageData.mode === "send" && !packageData.ticket && busy;

  const maskedTicket = useMemo(
    () => (packageData.ticket ? `${buildReceiveLink(packageData.ticket).slice(0, 24)}...` : ""),
    [packageData.ticket],
  );

  return {
    busy,
    cancelDownload,
    cancelGenerateTicket,
    copyTicket,
    error,
    generateTicket,
    isGeneratingTicket,
    maskedTicket,
    openDownloadFolder,
    removePreparingFile,
    setError,
    startDownload,
  };
}
