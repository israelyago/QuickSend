import { type Package, type Settings } from "../types/domain";
import { type PackageRow } from "../hooks/usePackageRows";
import { PackageFileDropzone } from "./PackageFileDropzone";
import { ReceiveTransferProgress } from "./ReceiveTransferProgress";
import { PackageFilesTable } from "./PackageFilesTable";

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
      />

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </>
  );
}
