import { CloudDownload, Package as PackageIcon } from "lucide-react";
import { Progress } from "./ui/progress";
import { type Package, type Settings } from "../types/domain";
import { formatBytes } from "../lib/formatters";

type ReceivePackageCardProps = {
  pkg: Package;
  sizeUnit: Settings["sizeUnit"];
  onOpen: () => void;
};

export function ReceivePackageCard({ pkg, sizeUnit, onOpen }: ReceivePackageCardProps) {
  const progressPercent = Math.min(
    100,
    Math.round(((pkg.transferredBytes ?? 0) / Math.max(pkg.totalSizeBytes, 1)) * 100),
  );
  const Icon = pkg.status === "transferring" ? CloudDownload : PackageIcon;

  return (
    <button
      type="button"
      className="flex w-full aspect-square flex-col rounded-md border border-input bg-background p-3 text-left transition hover:bg-accent/40 dark:hover:bg-accent"
      onClick={onOpen}
    >
      <span className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        Package
      </span>
      <span className="flex flex-1 items-center justify-center text-lg font-semibold text-muted-foreground">
        {formatBytes(pkg.totalSizeBytes, sizeUnit)}
      </span>
      {pkg.status === "transferring" ? (
        <div className="space-y-1">
          <Progress value={progressPercent} className="h-1.5" />
          <p className="text-[11px] text-muted-foreground">
            {formatBytes(pkg.transferredBytes ?? 0, sizeUnit)} /{" "}
            {formatBytes(pkg.totalSizeBytes, sizeUnit)}
          </p>
        </div>
      ) : null}
    </button>
  );
}
