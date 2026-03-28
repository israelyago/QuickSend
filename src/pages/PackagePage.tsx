import { useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useAppStore } from "../store/appStore";
import { Package } from "lucide-react";
import { TooltipProvider } from "../components/ui/tooltip";
import { usePackageRows } from "../hooks/usePackageRows";
import { useReceiveTransferStats } from "../hooks/useReceiveTransferStats";
import { PackagePageHeader } from "../components/PackagePageHeader";
import { PackagePageContent } from "../components/PackagePageContent";
import { usePackageActions } from "../hooks/usePackageActions";
import { useAutoDownloadOnIdleReceive } from "../hooks/useAutoDownloadOnIdleReceive";
import { inspectFilesWithFolderWarnings } from "../lib/inspectFiles";
import { useWebviewFileDrop } from "../hooks/useWebviewFileDrop";
import { formatBytes, formatDuration } from "../lib/formatters";
import { useRowActionMenu } from "../hooks/useRowActionMenu";
import { useFileSelectionDialog } from "../hooks/useFileSelectionDialog";

export function PackagePage() {
  const { id } = useParams<{ id: string }>();
  const packages = useAppStore((state) => state.packages);
  const settings = useAppStore((state) => state.settings);
  const attachTicketToPackage = useAppStore((state) => state.attachTicketToPackage);
  const attachReceiveSession = useAppStore((state) => state.attachReceiveSession);
  const startPackagePrepare = useAppStore((state) => state.startPackagePrepare);
  const markPreparingFileCancelled = useAppStore((state) => state.markPreparingFileCancelled);
  const markCancelledBySession = useAppStore((state) => state.markCancelledBySession);
  const removeFileFromPackage = useAppStore((state) => state.removeFileFromPackage);
  const removeFilesFromPackage = useAppStore((state) => state.removeFilesFromPackage);
  const addFilesToPackage = useAppStore((state) => state.addFilesToPackage);

  const pkg = useMemo(() => {
    if (id === "current") {
      return packages[0];
    }
    return packages.find((item) => item.id === id);
  }, [id, packages]);

  if (!pkg) {
    return (
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-slate-500 dark:text-zinc-400" aria-hidden="true" />
          <h2 className="text-2xl font-semibold">Package</h2>
        </div>
        <p className="text-sm text-red-600">Package not found for id: {id}</p>
      </section>
    );
  }
  const packageData = pkg;
  const {
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
  } = usePackageActions({
    packageData,
    settings,
    attachTicketToPackage,
    attachReceiveSession,
    startPackagePrepare,
    markPreparingFileCancelled,
    markCancelledBySession,
  });
  const canEditFiles =
    packageData.mode === "send" && !packageData.ticket && !isGeneratingTicket;
  const filesLocked = packageData.mode === "send" && !canEditFiles;
  const rows = usePackageRows(packageData);
  const {
    activeMenuId,
    activeRow,
    menuPosition,
    setActiveMenuId,
    setActiveMenuRect,
  } = useRowActionMenu({ canEditFiles, rows });
  const { progressPercent, rateBps, etaSeconds } = useReceiveTransferStats({ packageData });
  const { selectFiles } = useFileSelectionDialog({ title: "Select files to add" });

  const addFilesFromPaths = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) {
        return;
      }

      setError(null);
      try {
        const inspected = await inspectFilesWithFolderWarnings(paths);

        const newFiles = inspected.map((file) => ({
          id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          sizeBytes: file.sizeBytes,
          mimeType: file.mimeType,
          sourcePath: file.path,
        }));

        addFilesToPackage({
          packageId: packageData.id,
          files: newFiles,
          selectedRoots: paths,
        });
      } catch (cause) {
        setError(String(cause));
      }
    },
    [addFilesToPackage, packageData.id],
  );

  const { isDragActive } = useWebviewFileDrop({
    enabled: packageData.mode === "send" && canEditFiles,
    onDropPaths: (paths) => {
      void addFilesFromPaths(paths);
    },
  });

  const selectAdditionalFiles = useCallback(async () => {
    if (!canEditFiles) {
      return;
    }
    const paths = await selectFiles();
    if (!paths) {
      return;
    }
    void addFilesFromPaths(paths);
  }, [addFilesFromPaths, canEditFiles, selectFiles]);
  useAutoDownloadOnIdleReceive({
    busy,
    packageData,
    settings,
    startDownload,
  });

  return (
    <TooltipProvider delayDuration={100}>
      <section className="space-y-6">
        <PackagePageHeader
          packageData={packageData}
          busy={busy}
          isGeneratingTicket={isGeneratingTicket}
          maskedTicket={maskedTicket}
          onGenerateTicket={generateTicket}
          onCopyTicket={() => {
            void copyTicket();
          }}
          onOpenDownloadFolder={() => {
            void openDownloadFolder();
          }}
          onStartDownload={() => {
            void startDownload();
          }}
        />
        <PackagePageContent
          packageData={packageData}
          settings={settings}
          filesLocked={filesLocked}
          canEditFiles={canEditFiles}
          rows={rows}
          activeMenuId={activeMenuId}
          activeRow={activeRow}
          menuPosition={menuPosition}
          setActiveMenuId={setActiveMenuId}
          setActiveMenuRect={setActiveMenuRect}
          removeFileFromPackage={removeFileFromPackage}
          removeFilesFromPackage={removeFilesFromPackage}
          removePreparingFile={removePreparingFile}
          busy={busy}
          etaSeconds={etaSeconds}
          progressPercent={progressPercent}
          rateBps={rateBps}
          isDragActive={isDragActive}
          onSelectAdditionalFiles={selectAdditionalFiles}
          onCancelDownload={() => {
            void cancelDownload();
          }}
          formatBytes={formatBytes}
          formatDuration={formatDuration}
          error={error}
        />
      </section>
    </TooltipProvider>
  );
}
