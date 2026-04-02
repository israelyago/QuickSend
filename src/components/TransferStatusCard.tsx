import { type Package, type Settings } from "../types/domain";
import { ArrowUp, Check, Copy, Dot } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";

type Props = {
  packageData: Package;
  settings: Settings;
  etaSeconds: number | null;
  progressPercent: number;
  rateBps: number | null;
  maskedTicket: string;
  onCancelDownload: () => void;
  onGenerateTicket: () => void;
  onCopyTicket: () => void;
  onDone?: () => void;
  formatBytes: (value: number, standard: "jedec" | "iec") => string;
  formatDuration: (seconds: number) => string;
};

export function TransferStatusCard({
  packageData,
  settings,
  etaSeconds,
  progressPercent,
  rateBps,
  maskedTicket,
  onCancelDownload,
  onGenerateTicket,
  onCopyTicket,
  onDone,
  formatBytes,
  formatDuration,
}: Props) {
  const isFinalized = !!packageData.ticket;
  const isCompletedPreparing = packageData.prepareStatus === "completed";

  const prepareProgress = packageData.prepareProgress;
  const processedBytes = prepareProgress?.processedBytes ?? 0;
  const totalBytes = prepareProgress?.totalBytes ?? packageData.totalSizeBytes;

  return (
    <div className="flex items-center justify-center py-12 px-4 animate-in fade-in zoom-in duration-300">
      <Card className="w-full max-w-md shadow-2xl border-slate-200 dark:border-zinc-800 overflow-hidden">
        <CardContent className="pt-10 pb-8 flex flex-col items-center text-center gap-6">
          <div className={`h-20 w-20 ${isFinalized ? "bg-green-500/10" : "bg-primary/10"} rounded-full flex items-center justify-center transition-colors duration-500`}>
            {isFinalized ? (
              <Check className="h-10 w-10 text-green-500 animate-in zoom-in duration-500" />
            ) : (
              <ArrowUp className={`h-10 w-10 text-primary ${!isCompletedPreparing ? "animate-bounce" : ""}`} />
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-2xl font-bold text-slate-900 dark:text-zinc-100">
              {isFinalized
                ? "Your link is ready!"
                : isCompletedPreparing
                  ? "Prepared"
                  : "Preparing..."}
            </h3>
            <div className="flex flex-col gap-1 text-sm text-slate-500 dark:text-zinc-400 min-h-[40px] justify-center">
              {isFinalized ? (
                <span>You can copy the download link:</span>
              ) : (
                <>
                  <div className="flex items-center justify-center gap-1.5">
                    <span>
                      prepared {formatBytes(processedBytes, settings.sizeUnit)} of{" "}
                      {formatBytes(totalBytes, settings.sizeUnit)}
                    </span>
                    <Dot className="h-4 w-4" />
                    <span>{rateBps ? `${formatBytes(rateBps, settings.sizeUnit)}/s` : "Waiting..."}</span>
                  </div>
                  {etaSeconds !== null && (
                    <span className="font-medium text-primary/80">
                      {formatDuration(etaSeconds)} remaining
                    </span>
                  )}
                </>
              )}
            </div>
          </div>

          {isFinalized ? (
            <div className="w-full animate-in slide-in-from-bottom-2 duration-500">
              <div
                className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border-2 border-primary/20 bg-primary/5 p-4 text-sm font-mono text-primary transition-all hover:bg-primary/10 hover:border-primary/40 group active:scale-[0.99]"
                onClick={onCopyTicket}
                role="button"
                aria-label="Copy package address"
              >
                <span className="min-w-0 flex-1 truncate select-none">{maskedTicket}</span>
                <div className="flex items-center justify-center p-2 rounded-lg bg-white dark:bg-zinc-800 shadow-sm group-hover:shadow transition-all group-active:scale-95">
                  <Copy className="h-4 w-4" aria-hidden="true" />
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-400 dark:text-zinc-500 italic">
                Click the address to copy
              </p>
            </div>
          ) : (
            <div className="w-full space-y-2">
              <Progress value={progressPercent} className="h-2.5 transition-all" />
              <div className="flex justify-end">
                <span className="text-xs font-mono text-slate-400 dark:text-zinc-500">
                  {progressPercent}%
                </span>
              </div>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex gap-3 pt-4 pb-6 px-6 border-t border-slate-100 dark:border-zinc-800/50">
          {isFinalized ? (
            <Button
              className="w-full h-11 text-base shadow-sm hover:shadow transition-all"
              onClick={onDone}
            >
              Upload more files
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                className="flex-1 font-semibold h-11"
                onClick={onCancelDownload}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 font-bold h-11 shadow-sm hover:shadow transition-all"
                disabled={!isCompletedPreparing}
                onClick={onGenerateTicket}
              >
                Copy Link
              </Button>
            </>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
