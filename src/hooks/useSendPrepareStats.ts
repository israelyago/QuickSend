import { useEffect, useMemo, useState } from "react";
import { type Package } from "../types/domain";

type Args = {
  packageData: Package;
};

export function useSendPrepareStats({ packageData }: Args) {
  const [rateBps, setRateBps] = useState<number | null>(null);
  const [lastProgress, setLastProgress] = useState<{
    bytes: number;
    timeMs: number;
  } | null>(null);
  const [lastUiUpdate, setLastUiUpdate] = useState<number>(0);

  const prepareProgress = packageData.prepareProgress;
  const processedBytes = prepareProgress?.processedBytes ?? 0;
  const totalBytes = prepareProgress?.totalBytes ?? packageData.totalSizeBytes;

  const progressPercent = useMemo(() => {
    if (packageData.mode !== "send" || !totalBytes) {
      return 0;
    }
    return Math.min(100, Math.round((processedBytes / Math.max(totalBytes, 1)) * 100));
  }, [packageData.mode, processedBytes, totalBytes]);

  const remainingBytes = useMemo(() => {
    if (packageData.mode !== "send") {
      return 0;
    }
    return Math.max(0, totalBytes - processedBytes);
  }, [packageData.mode, processedBytes, totalBytes]);

  const etaSeconds = useMemo(
    () => (rateBps ? Math.ceil(remainingBytes / rateBps) : null),
    [rateBps, remainingBytes],
  );

  useEffect(() => {
    if (packageData.mode !== "send" || packageData.prepareStatus !== "preparing") {
      setRateBps(null);
      setLastProgress(null);
      setLastUiUpdate(0);
      return;
    }

    const now = Date.now();
    const currentBytes = processedBytes;
    if (!lastProgress) {
      setLastProgress({ bytes: currentBytes, timeMs: now });
      return;
    }

    const deltaBytes = currentBytes - lastProgress.bytes;
    const deltaMs = now - lastProgress.timeMs;
    const minUiIntervalMs = 750;
    const shouldUpdateUi = now - lastUiUpdate >= minUiIntervalMs;

    if (deltaBytes > 0 && deltaMs > 0 && shouldUpdateUi) {
      const instantRate = (deltaBytes / deltaMs) * 1000;
      setRateBps((prev) => (prev ? prev * 0.7 + instantRate * 0.3 : instantRate));
      setLastProgress({ bytes: currentBytes, timeMs: now });
      setLastUiUpdate(now);
    } else if (deltaMs > 3000 && shouldUpdateUi) {
      setLastProgress({ bytes: currentBytes, timeMs: now });
      setLastUiUpdate(now);
    }
  }, [lastProgress, lastUiUpdate, packageData.mode, packageData.prepareStatus, processedBytes]);

  return {
    etaSeconds,
    progressPercent,
    rateBps,
    processedBytes,
    totalBytes,
  };
}
