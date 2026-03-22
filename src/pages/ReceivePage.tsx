import { useCallback, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../store/appStore";
import { ReceivePackageCard } from "../components/ReceivePackageCard";
import { useReceiveClipboardTicketSync } from "../hooks/useReceiveClipboardTicketSync";

type PackagePreviewResponse = {
  packageId: string;
  files: Array<{
    name: string;
    sizeBytes: number;
    mimeType: string;
  }>;
  totalSizeBytes: number;
};

function isLikelyTicket(ticket: string) {
  return ticket.trim().startsWith("blob");
}

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
        if (!isLikelyTicket(rawTicket)) {
          throw new Error("Ticket format looks invalid.");
        }

        const ticket = rawTicket.trim();
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

        setAutoPreviewedClipboardTicket(ticket);
        setReceiveDraftTicket("");
        navigate(`/package/${localId}`);
      } catch (cause) {
        setError(String(cause));
      } finally {
        setBusy(false);
      }
    },
    [createReceivePreviewPackage, navigate, setAutoPreviewedClipboardTicket],
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
    <section className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold">Receive</h2>
        <p className="text-sm text-muted-foreground">Paste a ticket and preview package contents.</p>
      </header>

      <div className="rounded-lg border border-border bg-card p-4">
        <label className="mb-2 block text-sm font-medium" htmlFor="ticket-input">
          Ticket
        </label>
        <textarea
          id="ticket-input"
          className="h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
          placeholder="Paste package ticket here"
          value={receiveDraftTicket}
          onChange={(event) => setReceiveDraftTicket(event.target.value)}
        />

        <button
          className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          type="button"
          onClick={previewPackage}
          disabled={busy || receiveDraftTicket.trim().length === 0}
        >
          {busy ? "Previewing..." : "Preview Package"}
        </button>

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </div>

      {receivePackages.length === 0 ? null : (
        <div id="receive-packages-list" className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {receivePackages.map((pkg) => (
            <ReceivePackageCard
              key={pkg.id}
              pkg={pkg}
              sizeUnit={settings.sizeUnit}
              onOpen={() => navigate(`/package/${pkg.id}`)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
