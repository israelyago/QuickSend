import { useEffect, useState } from "react";
import { type Package, type Settings } from "../types/domain";

type Args = {
  busy: boolean;
  packageData: Package;
  settings: Settings;
  startDownload: () => Promise<void>;
};

export function useAutoDownloadOnIdleReceive({
  busy,
  packageData,
  settings,
  startDownload,
}: Args) {
  const [autoDownloadTriggered, setAutoDownloadTriggered] = useState(false);

  useEffect(() => {
    if (packageData.mode !== "receive") {
      return;
    }
    if (autoDownloadTriggered || busy) {
      return;
    }
    if (packageData.status !== "idle" || packageData.sessionId) {
      return;
    }
    if (settings.autoDownloadMaxBytes === 0) {
      return;
    }
    if (
      settings.autoDownloadMaxBytes > 0 &&
      packageData.totalSizeBytes > settings.autoDownloadMaxBytes
    ) {
      return;
    }
    setAutoDownloadTriggered(true);
    void startDownload();
  }, [
    autoDownloadTriggered,
    busy,
    packageData.mode,
    packageData.sessionId,
    packageData.status,
    packageData.totalSizeBytes,
    settings.autoDownloadMaxBytes,
    startDownload,
  ]);
}
