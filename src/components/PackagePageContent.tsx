import { type Package, type Settings } from "../types/domain";
import { type PackageRow } from "../hooks/usePackageRows";
import { FolderPlus } from "lucide-react";
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
  onSelectFolder: () => void;
  setActiveMenuId: (id: string | null) => void;
  setActiveMenuRect: (rect: DOMRect | null) => void;
  removeFileFromPackage: (payload: { packageId: string; fileId: string }) => void;
  removeFilesFromPackage: (payload: { packageId: string; fileIds: string[] }) => void;
  removePreparingFile: (
    fileId: string,
    prepareBackendFileId?: string,
    sourcePath?: string,
  ) => void;
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
  onSelectFolder,
  setActiveMenuId,
  setActiveMenuRect,
  removeFileFromPackage,
  removeFilesFromPackage,
  removePreparingFile,
  formatBytes,
  formatDuration,
}: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
      {/* Left Column: Progress & Table */}
      <div className="flex flex-col gap-4 order-2 md:order-1">
        {packageData.mode === "send" &&
          packageData.prepareStatus &&
          packageData.prepareStatus !== "completed" &&
          packageData.prepareStatus !== "idle" &&
          packageData.prepareProgress ? (
          <div className="rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium text-slate-900 dark:text-zinc-100">
                {packageData.prepareStatus === "failed"
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
      </div>

      {/* Right Column: Dropzones */}
      <div className="rounded-xl bg-card text-card-foreground shadow-sm p-6 flex flex-col gap-4 order-1 md:order-2">
        {packageData.mode === "send" && canEditFiles ? (
          <div className="flex flex-row gap-3">
            <div className="flex-1">
              <PackageFileDropzone
                isDragActive={isDragActive}
                onPrimarySelection={onSelectAdditionalFiles}
                onSecondarySelection={() => { }}
                variant="compact"
              />
            </div>
            <div className="flex-1">
              <PackageFileDropzone
                isDragActive={isDragActive}
                onPrimarySelection={onSelectFolder}
                onSecondarySelection={() => { }}
                icon={FolderPlus}
                primaryMessage="Add Folders"
                variant="compact"
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
