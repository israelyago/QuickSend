import { useMemo } from "react";
import { useParams, useNavigate, Navigate } from "react-router-dom";
import { useAppStore } from "../store/appStore";
import { usePackageActions } from "../hooks/usePackageActions";
import { useReceiveTransferStats } from "../hooks/useReceiveTransferStats";
import { formatBytes, formatDuration } from "../lib/formatters";
import { ReceiveStatusCard } from "../components/ReceiveStatusCard";
import { TooltipProvider } from "../components/ui/tooltip";
import { Package } from "../types/domain";

function ReceivePackageContent({ packageData }: { packageData: Package }) {
  const navigate = useNavigate();
  const settings = useAppStore((state) => state.settings);
  const attachTicketToPackage = useAppStore((state) => state.attachTicketToPackage);
  const attachReceiveSession = useAppStore((state) => state.attachReceiveSession);
  const startPackagePrepare = useAppStore((state) => state.startPackagePrepare);
  const markCancelledBySession = useAppStore((state) => state.markCancelledBySession);
  const removeFileFromPackage = useAppStore((state) => state.removeFileFromPackage);

  const {
    startDownload,
    cancelDownload,
    openDownloadFolder,
    busy,
  } = usePackageActions({
    packageData,
    settings,
    attachTicketToPackage,
    attachReceiveSession,
    startPackagePrepare,
    removeFileFromPackage,
    markCancelledBySession,
  });

  const { progressPercent, rateBps, etaSeconds } = useReceiveTransferStats({ 
    packageData 
  });

  // In the receive flow, "busy" from usePackageActions indicates an active background action (like starting download)
  // But we mostly care if the package status is "transferring"
  const isDownloading = packageData.status === "transferring" || busy;

  return (
    <TooltipProvider delayDuration={100}>
      <div className="min-h-[500px] flex items-center justify-center">
        <ReceiveStatusCard
          packageData={packageData}
          settings={settings}
          progressPercent={progressPercent}
          rateBps={rateBps}
          etaSeconds={etaSeconds}
          isDownloading={isDownloading}
          onDownload={startDownload}
          onCancel={cancelDownload}
          onOpenFolder={openDownloadFolder}
          onDone={() => navigate("/receive")}
          formatBytes={formatBytes}
          formatDuration={formatDuration}
        />
      </div>
    </TooltipProvider>
  );
}

export function ReceivePackagePage() {
  const { id } = useParams<{ id: string }>();
  const packages = useAppStore((state) => state.packages);

  const packageData = useMemo(() => {
    return packages.find((p) => p.id === id);
  }, [id, packages]);

  if (!packageData) {
    return <Navigate to="/receive" replace />;
  }

  return <ReceivePackageContent packageData={packageData} />;
}
