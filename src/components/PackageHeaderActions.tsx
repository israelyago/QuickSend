import { CloudDownload, Copy, FolderOpen } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { type Package } from "../types/domain";

type Props = {
  packageData: Package;
  busy: boolean;
  isGeneratingTicket: boolean;
  maskedTicket: string;
  onGenerateTicket: () => void;
  onCopyTicket: () => void;
  onOpenDownloadFolder: () => void;
  onStartDownload: () => void;
};

export function PackageHeaderActions({
  packageData,
  busy,
  isGeneratingTicket,
  maskedTicket,
  onGenerateTicket,
  onCopyTicket,
  onOpenDownloadFolder,
  onStartDownload,
}: Props) {
  if (packageData.mode === "send") {
    return (
      <div className="flex items-center">
        {!isGeneratingTicket && !packageData.ticket ? (
          <button
            className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-primary text-primary-foreground hover:opacity-90 h-10 px-4 py-2"
            type="button"
            onClick={onGenerateTicket}
          >
            Get Package Address
          </button>
        ) : null}

        {!isGeneratingTicket && packageData.ticket ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                className="flex cursor-pointer items-center gap-3 rounded-md border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-800 p-3 text-xs text-slate-700 dark:text-zinc-200 transition hover:border-slate-300 dark:hover:border-zinc-600"
                onClick={onCopyTicket}
                role="button"
                aria-label="Copy package ticket"
              >
                <span className="min-w-0 flex-1 truncate">{maskedTicket}</span>
                <Copy className="h-5 w-5 text-slate-500 dark:text-zinc-400" aria-hidden="true" />
              </div>
            </TooltipTrigger>
            <TooltipContent>Click on the ticket to copy again it.</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    );
  }

  if (packageData.mode === "receive") {
    return (
      <div className="flex items-center gap-3">
        {packageData.status === "completed" ? (
          <button
            className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
            type="button"
            onClick={onOpenDownloadFolder}
            disabled={busy}
          >
            <FolderOpen className="h-4 w-4" aria-hidden="true" />
            Open files folder
          </button>
        ) : (
          <button
            className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
            type="button"
            onClick={onStartDownload}
            disabled={busy || packageData.status === "transferring"}
          >
            <CloudDownload className="h-4 w-4" aria-hidden="true" />
            {busy ? "Starting..." : "Download Package"}
          </button>
        )}
      </div>
    );
  }

  return null;
}
