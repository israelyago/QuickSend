import { Package } from "lucide-react";
import { type Package as PackageType } from "../types/domain";
import { PackageHeaderActions } from "./PackageHeaderActions";

type Props = {
  busy: boolean;
  isGeneratingTicket: boolean;
  maskedTicket: string;
  packageData: PackageType;
  onCopyTicket: () => void;
  onGenerateTicket: () => void;
  onOpenDownloadFolder: () => void;
  onStartDownload: () => void;
};

export function PackagePageHeader({
  busy,
  isGeneratingTicket,
  maskedTicket,
  packageData,
  onCopyTicket,
  onGenerateTicket,
  onOpenDownloadFolder,
  onStartDownload,
}: Props) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-slate-500 dark:text-zinc-400" aria-hidden="true" />
          <h2 className="text-2xl font-semibold">Package</h2>
        </div>
        <p className="text-sm text-slate-600 dark:text-zinc-300">
          ID: {packageData.id} | Status: {packageData.status}
        </p>
        {packageData.peerId ? (
          <p className="text-sm text-emerald-700">Peer connected: {packageData.peerId}</p>
        ) : null}
      </div>

      <PackageHeaderActions
        packageData={packageData}
        busy={busy}
        isGeneratingTicket={isGeneratingTicket}
        maskedTicket={maskedTicket}
        onGenerateTicket={onGenerateTicket}
        onCopyTicket={onCopyTicket}
        onOpenDownloadFolder={onOpenDownloadFolder}
        onStartDownload={onStartDownload}
      />
    </header>
  );
}
