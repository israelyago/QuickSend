import { useEffect, useMemo, useState } from "react";
import { type Package } from "../types/domain";

type Args = {
  packageData: Package;
};

export function useReceiveTransferStats({ packageData }: Args) {
  const [rateBps, setRateBps] = useState<number | null>(null);
  const [lastProgress, setLastProgress] = useState<{
    bytes: number;
    timeMs: number;
  } | null>(null);
  const [lastUiUpdate, setLastUiUpdate] = useState<number>(0);

  const progressPercent = useMemo(() => {
    if (packageData.mode !== "receive") {
      return 0;
    }
    return Math.min(
      100,
      Math.round(
        ((packageData.transferredBytes ?? 0) / Math.max(packageData.totalSizeBytes, 1)) * 100,
      ),
    );
  }, [packageData.mode, packageData.totalSizeBytes, packageData.transferredBytes]);

  const remainingBytes = useMemo(() => {
    if (packageData.mode !== "receive") {
      return 0;
    }
    return Math.max(0, packageData.totalSizeBytes - (packageData.transferredBytes ?? 0));
  }, [packageData.mode, packageData.totalSizeBytes, packageData.transferredBytes]);

  const etaSeconds = useMemo(
    () => (rateBps ? Math.ceil(remainingBytes / rateBps) : null),
    [rateBps, remainingBytes],
  );

  useEffect(() => {
    if (packageData.mode !== "receive" || packageData.status !== "transferring") {
      setRateBps(null);
      setLastProgress(null);
      setLastUiUpdate(0);
      return;
    }

    const now = Date.now();
    const currentBytes = packageData.transferredBytes ?? 0;
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
  }, [
    lastProgress,
    lastUiUpdate,
    packageData.mode,
    packageData.status,
    packageData.transferredBytes,
  ]);

  return {
    etaSeconds,
    progressPercent,
    rateBps,
  };
}
