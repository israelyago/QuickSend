import { CloudDownload, Gauge, Hourglass, OctagonX } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { Progress } from "./ui/progress";
import { Field } from "./ui/field";

type Props = {
  busy: boolean;
  etaSeconds: number | null;
  progressPercent: number;
  rateBps: number | null;
  sizeUnit: "jedec" | "iec";
  totalSizeBytes: number;
  transferredBytes: number;
  onCancelDownload: () => void;
  formatBytes: (value: number, standard: "jedec" | "iec") => string;
  formatDuration: (seconds: number) => string;
};

export function ReceiveTransferProgress({
  busy,
  etaSeconds,
  progressPercent,
  rateBps,
  sizeUnit,
  totalSizeBytes,
  transferredBytes,
  onCancelDownload,
  formatBytes,
  formatDuration,
}: Props) {
  return (
    <div className="qs-slide-down rounded-lg py-2">
      <div className="mb-1 flex items-center justify-between">
        <Field className="gap-1">
          <div className="flex items-center gap-1 text-xs text-slate-600 dark:text-zinc-300">
            <Gauge className="h-5 w-5 text-slate-400 dark:text-zinc-500" aria-hidden="true" />
            <span>{rateBps ? `${formatBytes(Math.round(rateBps), sizeUnit)}/s` : "—/s"}</span>
          </div>
        </Field>
        <Field className="items-end gap-1 text-right">
          <div className="flex items-center gap-1 text-xs text-slate-600 dark:text-zinc-300">
            <span>{etaSeconds ? formatDuration(etaSeconds) : "—:—"}</span>
            <Hourglass className="h-5 w-5 text-slate-400 dark:text-zinc-500" aria-hidden="true" />
          </div>
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <CloudDownload className="h-5 w-5 text-slate-500 dark:text-zinc-400" aria-hidden="true" />
        <Progress value={progressPercent} className="flex-1" />
        <span className="text-xs text-slate-500 dark:text-zinc-400 whitespace-nowrap">
          {formatBytes(transferredBytes, sizeUnit)} / {formatBytes(totalSizeBytes, sizeUnit)}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 hover:text-slate-900 dark:hover:text-zinc-100"
              type="button"
              onClick={onCancelDownload}
              disabled={busy}
              aria-label="Cancel download"
            >
              <OctagonX className="h-4 w-4" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Cancel download</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
