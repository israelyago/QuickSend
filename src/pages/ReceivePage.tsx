import { useCallback, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../store/appStore";
import { ReceivePackageCard } from "../components/ReceivePackageCard";
import { useReceiveClipboardTicketSync } from "../hooks/useReceiveClipboardTicketSync";
import { resolveTicketInput } from "../lib/ticketLink";
import { Card, CardContent, CardFooter } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { ArrowDown, History, Loader2 } from "lucide-react";

type PackagePreviewResponse = {
  packageId: string;
  files: Array<{
    name: string;
    sizeBytes: number;
    mimeType: string;
  }>;
  totalSizeBytes: number;
};

export function ReceivePage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const packages = useAppStore((state) => state.packages);
  const settings = useAppStore((state) => state.settings);
  const receiveDraftTicket = useAppStore((state) => state.receiveDraftTicket);
  const setReceiveDraftTicket = useAppStore((state) => state.setReceiveDraftTicket);
  const createReceivePreviewPackage = useAppStore((state) => state.createReceivePreviewPackage);
  const autoPreviewedClipboardTicket = useAppStore((state) => state.autoPreviewedClipboardTicket);
  const setAutoPreviewedClipboardTicket = useAppStore((state) => state.setAutoPreviewedClipboardTicket);
  const autoFilledClipboardTicket = useAppStore((state) => state.autoFilledClipboardTicket);
  const setAutoFilledClipboardTicket = useAppStore((state) => state.setAutoFilledClipboardTicket);
  const receivePackages = useMemo(
    () => packages.filter((pkg) => pkg.mode === "receive"),
    [packages],
  );

  const previewWithTicket = useCallback(
    async (rawTicket: string) => {
      setBusy(true);
      setError(null);
      try {
        const ticket = resolveTicketInput(rawTicket);
        if (!ticket) {
          throw new Error("Ticket format looks invalid.");
        }

        const preview = await invoke<PackagePreviewResponse>("package_preview", { ticket });

        const localId = createReceivePreviewPackage({
          packageId: preview.packageId,
          ticket,
          totalSizeBytes: preview.totalSizeBytes,
          files: preview.files.map((file, index) => ({
            id: `recv-${index}`,
            name: file.name,
            sizeBytes: file.sizeBytes,
            mimeType: file.mimeType,
          })),
        });

        setAutoPreviewedClipboardTicket(rawTicket.trim());
        setReceiveDraftTicket("");
        navigate(`/receive/${localId}`);
      } catch (cause) {
        setError(String(cause));
      } finally {
        setBusy(false);
      }
    },
    [createReceivePreviewPackage, navigate, setAutoPreviewedClipboardTicket, setReceiveDraftTicket],
  );

  useReceiveClipboardTicketSync({
    autoFilledClipboardTicket,
    autoPreviewedClipboardTicket,
    busy,
    receiveDraftTicket,
    previewWithTicket,
    setAutoFilledClipboardTicket,
    setReceiveDraftTicket,
  });

  async function previewPackage() {
    await previewWithTicket(receiveDraftTicket);
  }

  return (
    <div className="flex flex-col items-center gap-12 py-12 px-4 animate-in fade-in transition-all duration-700">
      <Card className="w-full max-w-[400px] shadow-sm border-slate-200 dark:border-zinc-800 overflow-hidden bg-card">
        <CardContent className="pt-10 pb-8 flex flex-col items-center text-center gap-6">
          <div className="h-20 w-20 bg-primary/10 rounded-full flex items-center justify-center transition-colors duration-500">
            <ArrowDown className="h-10 w-10 text-primary" />
          </div>

          <div className="space-y-2">
            <h3 className="text-2xl font-bold text-slate-900 dark:text-zinc-100">Download</h3>
            <p className="text-sm text-slate-500 dark:text-zinc-400">
              Paste your link here:
            </p>
          </div>

          <div className="w-full px-2">
            <input
              aria-label="quicksend-link"
              id="ticket-input"
              className="w-full h-12 px-4 rounded-xl border-2 border-primary/20 bg-primary/5 text-sm font-mono text-primary transition-all focus:bg-primary/10 focus:border-primary/40 focus:outline-none placeholder:text-primary/30"
              placeholder="quicksend://receive?..."
              value={receiveDraftTicket}
              onChange={(event) => setReceiveDraftTicket(event.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !busy && receiveDraftTicket.trim()) {
                  previewPackage();
                }
              }}
            />
            {error && (
              <p className="mt-3 text-xs text-red-500 animate-in fade-in slide-in-from-top-1 text-left px-2">
                {error}
              </p>
            )}
          </div>
        </CardContent>

        <CardFooter className="flex flex-col gap-3 pt-4 pb-6 px-6 border-t border-slate-100 dark:border-zinc-800/50">
          <Button
            className="w-full h-12 text-base font-bold shadow-sm transition-all active:scale-[0.98]"
            onClick={previewPackage}
            disabled={busy || receiveDraftTicket.trim().length === 0}
          >
            {busy ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Previewing...
              </>
            ) : (
              "Download"
            )}
          </Button>
        </CardFooter>
      </Card>

      {/* History Section - Adjusted width for better layout below the main card */}
      {receivePackages.length > 0 && (
        <div className="w-full max-w-5xl space-y-6">
          <div className="flex items-center gap-3 px-1">
            <History className="h-5 w-5 text-zinc-400" />
            <h3 className="text-lg font-bold text-slate-700 dark:text-zinc-300">Previous Packages</h3>
            <div className="h-px flex-1 bg-gradient-to-r from-slate-200 dark:from-zinc-800 to-transparent ml-2" />
          </div>

          <div id="receive-packages-list" className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {receivePackages.map((pkg) => (
              <div
                key={pkg.id}
                className="transition-transform hover:scale-[1.02] active:scale-[0.98]"
              >
                <ReceivePackageCard
                  pkg={pkg}
                  sizeUnit={settings.sizeUnit}
                  onOpen={() => navigate(`/receive/${pkg.id}`)}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
