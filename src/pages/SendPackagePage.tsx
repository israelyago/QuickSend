import { useCallback, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useAppStore } from "../store/appStore";
import { Package } from "lucide-react";
import { TooltipProvider } from "../components/ui/tooltip";
import { useReceiveTransferStats } from "../hooks/useReceiveTransferStats";
import { SendPackageContent } from "../components/SendPackageContent";
import { usePackageActions } from "../hooks/usePackageActions";
import { inspectFilesWithFolderWarnings } from "../lib/inspectFiles";
import { useWebviewFileDrop } from "../hooks/useWebviewFileDrop";
import { formatBytes, formatDuration } from "../lib/formatters";
import { useFileSelectionDialog } from "../hooks/useFileSelectionDialog";
import { useSendPrepareStats } from "../hooks/useSendPrepareStats";
import { type Package as PackageType } from "../types/domain";

type InnerProps = {
  pkg: PackageType;
};

function SendPackagePageInner({ pkg: packageData }: InnerProps) {
  const navigate = useNavigate();
  const [isFinalizing, setIsFinalizing] = useState(false);
  const settings = useAppStore((state) => state.settings);
  const attachTicketToPackage = useAppStore((state) => state.attachTicketToPackage);
  const attachReceiveSession = useAppStore((state) => state.attachReceiveSession);
  const startPackagePrepare = useAppStore((state) => state.startPackagePrepare);
  const markCancelledBySession = useAppStore((state) => state.markCancelledBySession);
  const removeFileFromPackage = useAppStore((state) => state.removeFileFromPackage);
  const addFilesToPackage = useAppStore((state) => state.addFilesToPackage);

  const {
    cancelDownload,
    cancelGenerateTicket,
    copyTicket,
    generateTicket,
    isGeneratingTicket,
    maskedTicket,
    setError,
  } = usePackageActions({
    packageData,
    settings,
    attachTicketToPackage,
    attachReceiveSession,
    startPackagePrepare,
    removeFileFromPackage,
    markCancelledBySession,
  });
  const canEditFiles =
    packageData.mode === "send" && !packageData.ticket && !isGeneratingTicket;
  const { progressPercent: receiveProgress, rateBps: receiveRate, etaSeconds: receiveEta } = useReceiveTransferStats({ packageData });
  const { progressPercent: sendProgress, rateBps: sendRate, etaSeconds: sendEta } = useSendPrepareStats({ packageData });

  const progressPercent = packageData.mode === "send" ? sendProgress : receiveProgress;
  const rateBps = packageData.mode === "send" ? sendRate : receiveRate;
  const etaSeconds = packageData.mode === "send" ? sendEta : receiveEta;
  const { selectFiles, selectFolders } = useFileSelectionDialog({ title: "Select files to add", foldersTitle: "Select a folder to add" });

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
    [addFilesToPackage, packageData.id, setError],
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

  const selectAdditionalFolders = useCallback(async () => {
    if (!canEditFiles) {
      return;
    }
    const paths = await selectFolders();
    if (!paths) {
      return;
    }
    void addFilesFromPaths(paths);
  }, [addFilesFromPaths, canEditFiles, selectFolders]);


  return (
    <TooltipProvider delayDuration={100}>
      <section className="space-y-6">
        <SendPackageContent
          packageData={packageData}
          settings={settings}
          etaSeconds={etaSeconds}
          progressPercent={progressPercent}
          rateBps={rateBps}
          isDragActive={isDragActive}
          onSelectAdditionalFiles={selectAdditionalFiles}
          onSelectFolder={selectAdditionalFolders}
          onCancelDownload={() => {
            setIsFinalizing(false);
            if (packageData.mode === "send" && isGeneratingTicket) {
              cancelGenerateTicket();
            } else {
              void cancelDownload();
            }
          }}
          formatBytes={formatBytes}
          formatDuration={formatDuration}
          isGeneratingTicket={isGeneratingTicket}
          maskedTicket={maskedTicket}
          onGenerateTicket={async () => {
            await generateTicket();
            setIsFinalizing(true);
          }}
          onCopyTicket={() => {
            void copyTicket();
          }}
          onDone={() => {
            setIsFinalizing(false);
            navigate("/send");
          }}
          isFinalizing={isFinalizing}
          removeFileFromPackage={removeFileFromPackage}
        />
      </section>
    </TooltipProvider>
  );
}

export function SendPackagePage() {
  const { id } = useParams<{ id: string }>();
  const packages = useAppStore((state) => state.packages);

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

  if (pkg.mode === "receive") {
    return <Navigate to={`/receive/${id}`} replace />;
  }

  return <SendPackagePageInner pkg={pkg} />;
}
