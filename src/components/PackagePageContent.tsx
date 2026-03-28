import { type Package, type Settings } from "../types/domain";
import { type PackageRow } from "../hooks/usePackageRows";
import { PackageFileDropzone } from "./PackageFileDropzone";
import { ReceiveTransferProgress } from "./ReceiveTransferProgress";
import { PackageFilesTable } from "./PackageFilesTable";
import { Progress } from "./ui/progress";

type Props = {
  activeMenuId: string | null;
  activeRow: PackageRow | null;
  busy: boolean;
  canEditFiles: boolean;
  error: string | null;
  etaSeconds: number | null;
  filesLocked: boolean;
  isDragActive: boolean;
  menuPosition: { top: number; right: number } | null;
  packageData: Package;
  progressPercent: number;
  rateBps: number | null;
  rows: PackageRow[];
  settings: Settings;
  onCancelDownload: () => void;
  onSelectAdditionalFiles: () => void;
  setActiveMenuId: (id: string | null) => void;
  setActiveMenuRect: (rect: DOMRect | null) => void;
  removeFileFromPackage: (payload: { packageId: string; fileId: string }) => void;
  removeFilesFromPackage: (payload: { packageId: string; fileIds: string[] }) => void;
  removePreparingFile: (fileId: string, prepareBackendFileId?: string) => void;
  formatBytes: (value: number, standard: "jedec" | "iec") => string;
  formatDuration: (seconds: number) => string;
};

export function PackagePageContent({
  activeMenuId,
  activeRow,
  busy,
  canEditFiles,
  error,
  etaSeconds,
  filesLocked,
  isDragActive,
  menuPosition,
  packageData,
  progressPercent,
  rateBps,
  rows,
  settings,
  onCancelDownload,
  onSelectAdditionalFiles,
  setActiveMenuId,
  setActiveMenuRect,
  removeFileFromPackage,
  removeFilesFromPackage,
  removePreparingFile,
  formatBytes,
  formatDuration,
}: Props) {
  return (
    <>
      {packageData.mode === "send" && canEditFiles ? (
        <PackageFileDropzone
          isDragActive={isDragActive}
          onSelectAdditionalFiles={onSelectAdditionalFiles}
        />
      ) : null}

      {packageData.mode === "send" &&
      packageData.prepareStatus &&
      packageData.prepareStatus !== "idle" &&
      packageData.prepareProgress ? (
        <div className="rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium text-slate-900 dark:text-zinc-100">
              {packageData.prepareStatus === "completed"
                ? "Finalizing package..."
                : packageData.prepareStatus === "failed"
                  ? "Prepare failed"
                  : packageData.prepareStatus === "cancelled"
                    ? "Prepare cancelled"
                    : "Preparing files..."}
            </span>
            <span className="text-slate-600 dark:text-zinc-300">
              {packageData.prepareProgress.completedFiles} / {packageData.prepareProgress.totalFiles}
            </span>
          </div>
          <Progress
            value={
              packageData.prepareProgress.totalFiles > 0
                ? (packageData.prepareProgress.completedFiles / packageData.prepareProgress.totalFiles) *
                  100
                : 0
            }
          />
        </div>
      ) : null}

      {packageData.mode === "receive" && packageData.status === "transferring" ? (
        <ReceiveTransferProgress
          busy={busy}
          etaSeconds={etaSeconds}
          progressPercent={progressPercent}
          rateBps={rateBps}
          sizeUnit={settings.sizeUnit}
          totalSizeBytes={packageData.totalSizeBytes}
          transferredBytes={packageData.transferredBytes ?? 0}
          onCancelDownload={onCancelDownload}
          formatBytes={formatBytes}
          formatDuration={formatDuration}
        />
      ) : null}

      <PackageFilesTable
        packageData={packageData}
        settings={settings}
        filesLocked={filesLocked}
        canEditFiles={canEditFiles}
        rows={rows}
        activeMenuId={activeMenuId}
        activeRow={activeRow}
        menuPosition={menuPosition}
        formatBytes={formatBytes}
        setActiveMenuId={setActiveMenuId}
        setActiveMenuRect={setActiveMenuRect}
        removeFileFromPackage={removeFileFromPackage}
        removeFilesFromPackage={removeFilesFromPackage}
        removePreparingFile={removePreparingFile}
      />

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </>
  );
}
