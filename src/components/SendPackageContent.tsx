import { type Package, type Settings } from "../types/domain";
import { Dot, FolderPlus, Trash2 } from "lucide-react";
import { PackageFileDropzone } from "./PackageFileDropzone";
import { TransferStatusCard } from "./TransferStatusCard";

type Props = {
  etaSeconds: number | null;
  isDragActive: boolean;
  packageData: Package;
  progressPercent: number;
  rateBps: number | null;
  settings: Settings;
  onCancelDownload: () => void;
  onSelectAdditionalFiles: () => void;
  onSelectFolder: () => void;
  removeFileFromPackage: (payload: { packageId: string; fileId: string }) => void;
  formatBytes: (value: number, standard: "jedec" | "iec") => string;
  formatDuration: (seconds: number) => string;
  isGeneratingTicket: boolean;
  maskedTicket: string;
  onGenerateTicket: () => void;
  onCopyTicket: () => void;
  onDone: () => void;
  isFinalizing: boolean;
};

export function SendPackageContent({
  etaSeconds,
  isDragActive,
  packageData,
  progressPercent,
  rateBps,
  settings,
  onCancelDownload,
  onSelectAdditionalFiles,
  onSelectFolder,
  removeFileFromPackage,
  formatBytes,
  formatDuration,
  isGeneratingTicket,
  maskedTicket,
  onGenerateTicket,
  onCopyTicket,
  onDone,
  isFinalizing,
}: Props) {
  if (isGeneratingTicket || isFinalizing || packageData.ticket) {
    return (
      <TransferStatusCard
        packageData={packageData}
        settings={settings}
        etaSeconds={etaSeconds}
        progressPercent={progressPercent}
        rateBps={rateBps}
        maskedTicket={maskedTicket}
        onCancelDownload={onCancelDownload}
        onGenerateTicket={onGenerateTicket}
        onCopyTicket={onCopyTicket}
        onDone={onDone}
        formatBytes={formatBytes}
        formatDuration={formatDuration}
      />
    );
  }

  return (
    <div role="grid" className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
      {/* Left Column: Package metadata */}
      <div className="rounded-xl bg-card text-card-foreground shadow-sm p-6 flex flex-col gap-4 order-2 md:order-1">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <button
              className="inline-flex w-full items-center justify-center whitespace-nowrap rounded-lg text-sm font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:opacity-90 shadow-md hover:shadow-lg active:scale-[0.98] h-11 px-6"
              type="button"
              onClick={onGenerateTicket}
              disabled={packageData.prepareStatus === "failed"}
            >
              Transfer
            </button>
          </div>
        </div>
      </div>

      {/* Right Column: Dropzones & Package Info */}
      <div className="rounded-xl bg-card text-card-foreground shadow-sm p-6 flex flex-col gap-4 order-1 md:order-2">
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

        <div className="flex flex-col items-start justify-center">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-zinc-300">
            <span>
              {packageData.files.length}{" "}
              {packageData.files.length === 1 ? "file" : "files"}
            </span>
            <Dot
              className="h-4 w-4 text-slate-300 dark:text-zinc-200"
              aria-hidden="true"
            />
            <span>
              {formatBytes(packageData.totalSizeBytes, settings.sizeUnit)}
            </span>
          </div>
        </div>
        <hr className="border-slate-200 dark:border-zinc-700" />

        <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
          {packageData.files.map((file) => {
            const isPreparing =
              file.prepareStatus === "importing" ||
              file.prepareStatus === "verifying" ||
              file.prepareStatus === "queued";
            return (
              <div
                key={file.id}
                className="group flex items-center justify-between h-12 px-3 rounded-md transition-all duration-200 hover:bg-slate-50 dark:hover:bg-zinc-600/50"
              >
                <span className="text-sm text-slate-700 dark:text-zinc-300 truncate mr-4 font-medium group-hover:text-primary transition-colors">
                  {file.name}
                </span>
                <div className="flex items-center justify-end h-full">
                  <span
                    className={`text-xs text-slate-400 dark:text-zinc-500 tabular-nums whitespace-nowrap group-hover:hidden`}
                  >
                    {isPreparing
                      ? `${formatBytes(
                        file.prepareProcessedBytes ?? 0,
                        settings.sizeUnit,
                      )} / ${formatBytes(file.sizeBytes, settings.sizeUnit)}`
                      : formatBytes(file.sizeBytes, settings.sizeUnit)}
                  </span>
                  <button
                    onClick={() =>
                      removeFileFromPackage({
                        packageId: packageData.id,
                        fileId: file.id,
                      })
                    }
                    className="hidden group-hover:flex items-center justify-center h-8 w-8 rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-slate-400 hover:text-red-500 dark:text-zinc-500 dark:hover:text-red-400 transition-all duration-200"
                    title="Remove file"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
