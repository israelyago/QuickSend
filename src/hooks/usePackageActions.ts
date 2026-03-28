import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openPath } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { type Package, type Settings } from "../types/domain";
import { buildReceiveLink } from "../lib/ticketLink";

type PackagePrepareStartResponse = {
  prepareSessionId: string;
  packageId: string;
};

type PackagePrepareFinalizeResponse = {
  sessionId: string;
  packageId: string;
  ticket: string;
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
  markPreparingFileCancelled: (payload: { packageId: string; fileId: string }) => void;
  markCancelledBySession: (sessionId: string) => void;
};

export function usePackageActions({
  packageData,
  settings,
  attachTicketToPackage,
  attachReceiveSession,
  startPackagePrepare,
  markPreparingFileCancelled,
  markCancelledBySession,
}: Args) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isFinalizingTicket, setIsFinalizingTicket] = useState(false);
  const finalizingRef = useRef(false);

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

    setBusy(true);
    setError(null);

    try {
      const response = await invoke<PackagePrepareStartResponse>("package_prepare_start", {
        files: packageData.sourcePaths,
        roots: packageData.selectedRoots ?? [],
      });
      startPackagePrepare({
        packageId: packageData.id,
        prepareSessionId: response.prepareSessionId,
      });
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }, [packageData.id, packageData.selectedRoots, packageData.sourcePaths, startPackagePrepare]);

  useEffect(() => {
    if (
      packageData.mode !== "send" ||
      packageData.prepareStatus !== "completed" ||
      !packageData.prepareSessionId ||
      packageData.ticket ||
      finalizingRef.current
    ) {
      return;
    }

    let cancelled = false;
    finalizingRef.current = true;
    setIsFinalizingTicket(true);
    setBusy(true);
    setError(null);

    void invoke<PackagePrepareFinalizeResponse>("package_prepare_finalize", {
      prepareSessionId: packageData.prepareSessionId,
    })
      .then(async (response) => {
        if (cancelled) {
          return;
        }

        attachTicketToPackage({
          packageId: packageData.id,
          sessionId: response.sessionId,
          backendPackageId: response.packageId,
          ticket: response.ticket,
        });
        await copyTicket(response.ticket);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(String(cause));
        }
      })
      .finally(() => {
        finalizingRef.current = false;
        if (!cancelled) {
          setBusy(false);
          setIsFinalizingTicket(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    attachTicketToPackage,
    copyTicket,
    packageData.id,
    packageData.mode,
    packageData.prepareSessionId,
    packageData.prepareStatus,
    packageData.ticket,
  ]);

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
    async (fileId: string, prepareBackendFileId?: string) => {
      if (!packageData.prepareSessionId || !prepareBackendFileId) {
        return;
      }
      try {
        markPreparingFileCancelled({ packageId: packageData.id, fileId });
        const response = await invoke<CancelResponse>("package_prepare_remove_file", {
          prepareSessionId: packageData.prepareSessionId,
          fileId: prepareBackendFileId,
        });
        if (!response.ok) {
          setError("Could not remove file from active preparation session.");
        }
      } catch (cause) {
        setError(String(cause));
      }
    },
    [markPreparingFileCancelled, packageData.id, packageData.prepareSessionId],
  );

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

  const isGeneratingTicket =
    packageData.mode === "send" &&
    !packageData.ticket &&
    (packageData.prepareStatus === "preparing" ||
      packageData.prepareStatus === "completed" ||
      isFinalizingTicket);

  const maskedTicket = useMemo(
    () => (packageData.ticket ? `${buildReceiveLink(packageData.ticket).slice(0, 24)}...` : ""),
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
    removePreparingFile,
    setError,
    startDownload,
  };
}
