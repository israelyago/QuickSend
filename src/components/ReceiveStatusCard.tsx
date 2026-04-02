import { type Package, type Settings } from "../types/domain";
import { ArrowDown, Check, Dot, X } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";

type Props = {
  packageData: Package;
  settings: Settings;
  progressPercent: number;
  rateBps: number | null;
  etaSeconds: number | null;
  isDownloading: boolean;
  onDownload: () => void;
  onCancel: () => void;
  onOpenFolder: () => void;
  onDone: () => void;
  formatBytes: (value: number, standard: "jedec" | "iec") => string;
  formatDuration: (seconds: number) => string;
};

export function ReceiveStatusCard({
  packageData,
  settings,
  progressPercent,
  rateBps,
  etaSeconds,
  isDownloading,
  onDownload,
  onCancel,
  onOpenFolder,
  onDone,
  formatBytes,
  formatDuration,
}: Props) {
  const isCompleted = packageData.status === "completed";
  const fileCount = packageData.files.length;
  const totalSize = packageData.totalSizeBytes;

  return (
    <div className="flex items-center justify-center py-12 px-4 animate-in fade-in zoom-in duration-500">
      <Card className="w-[90vw] max-w-[400px] shadow-sm border-slate-200 dark:border-zinc-800 overflow-hidden bg-card">
        <CardHeader className="p-4 flex flex-row items-center justify-end">
          <button
            onClick={onDone}
            className="p-3 rounded-full hover:bg-slate-100 dark:hover:bg-zinc-700 text-zinc-400 hover:text-slate-600 dark:hover:text-zinc-300 transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </CardHeader>
        <CardContent className="pt-6 pb-8 flex flex-col items-center text-center gap-6">
          <div className={`h-20 w-20 ${isCompleted ? "bg-green-500/10" : "bg-primary/10"} rounded-full flex items-center justify-center transition-colors duration-500 relative`}>
            {isDownloading && !isCompleted && (
              <div className="absolute inset-0 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
            )}
            {isCompleted ? (
              <Check className="h-10 w-10 text-green-500 animate-in zoom-in duration-500" />
            ) : (
              <ArrowDown className="h-10 w-10 text-primary" />
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-2xl font-bold text-slate-900 dark:text-zinc-100">
              {isCompleted ? "Download Complete!" : isDownloading ? "Downloading..." : "Ready to Download"}
            </h3>

            <div className="flex flex-col gap-1 text-sm text-slate-500 dark:text-zinc-400 min-h-[40px] justify-center items-center">
              {isCompleted ? (
                <span>All files have been saved to your download folder.</span>
              ) : isDownloading ? (
                <div className="min-h-[40px] flex items-center justify-center">
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1">
                  <p className="font-semibold text-slate-700 dark:text-zinc-300">Package</p>
                  <div className="flex items-center gap-1 text-xs opacity-80">
                    <span>{fileCount} {fileCount === 1 ? "file" : "files"}</span>
                    <Dot className="h-3 w-3" />
                    <span>{formatBytes(totalSize, settings.sizeUnit)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {isDownloading && !isCompleted && (
            <div className="w-full space-y-1 animate-in slide-in-from-bottom-2">
              <div className="flex justify-between items-center h-4 text-[10px] font-mono text-slate-400 dark:text-zinc-500">
                <span>{rateBps ? `${formatBytes(rateBps, settings.sizeUnit)}/s` : ""}</span>
                {etaSeconds !== null && (
                  <span>{formatDuration(etaSeconds)}</span>
                )}
              </div>
              <Progress value={progressPercent} className="h-2.5 transition-all" />
              <div className="flex justify-between items-center text-[10px] font-mono text-slate-400 dark:text-zinc-500">
                <span className="w-1/3 text-left">{formatBytes(packageData.transferredBytes ?? 0, settings.sizeUnit)}</span>
                <span className="w-1/3 text-center font-bold text-primary">{progressPercent}%</span>
                <span className="w-1/3 text-right whitespace-nowrap">
                  {formatBytes(totalSize, settings.sizeUnit)}
                </span>
              </div>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex flex-col gap-3 pt-4 pb-6 px-6 border-t border-slate-100 dark:border-zinc-800/50">
          {isCompleted ? (
            <Button
              className="w-full font-semibold h-11 border-primary/20 hover:bg-primary/90"
              onClick={onOpenFolder}
            >
              Open Files
            </Button>
          ) : isDownloading ? (
            <Button
              variant="outline"
              className="w-full h-11 transition-all"
              onClick={onCancel}
            >
              Cancel Download
            </Button>
          ) : (
            <Button
              className="w-full font-bold h-12 text-base shadow-sm transition-all active:scale-[0.98]"
              onClick={onDownload}
            >
              Download All
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
