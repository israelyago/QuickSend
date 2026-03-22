import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

type Args = {
  autoFilledClipboardTicket: string | null;
  autoPreviewedClipboardTicket: string | null;
  busy: boolean;
  receiveDraftTicket: string | null;
  previewWithTicket: (rawTicket: string) => Promise<void>;
  setAutoFilledClipboardTicket: (ticket: string) => void;
  setReceiveDraftTicket: (ticket: string) => void;
};

export function useReceiveClipboardTicketSync({
  autoFilledClipboardTicket,
  autoPreviewedClipboardTicket,
  busy,
  receiveDraftTicket,
  previewWithTicket,
  setAutoFilledClipboardTicket,
  setReceiveDraftTicket,
}: Args) {
  const didInitialClipboardCheck = useRef(false);

  useEffect(() => {
    if (didInitialClipboardCheck.current) {
      return;
    }
    didInitialClipboardCheck.current = true;

    if (receiveDraftTicket || busy) {
      return;
    }

    const previewFromClipboard = async () => {
      try {
        const ticket = await invoke<string | null>("clipboard_ticket");
        if (ticket && ticket !== autoPreviewedClipboardTicket) {
          setReceiveDraftTicket(ticket);
          await previewWithTicket(ticket);
        }
      } catch {
        // clipboard access optional
      }
    };

    void previewFromClipboard();
  }, [
    autoPreviewedClipboardTicket,
    busy,
    previewWithTicket,
    receiveDraftTicket,
    setReceiveDraftTicket,
  ]);

  const fillFromClipboard = useCallback(async () => {
    if (receiveDraftTicket || busy) {
      return;
    }

    try {
      const ticket = await invoke<string | null>("clipboard_ticket");
      if (ticket && ticket !== autoFilledClipboardTicket) {
        setReceiveDraftTicket(ticket);
        setAutoFilledClipboardTicket(ticket);
      }
    } catch {
      // clipboard access optional
    }
  }, [
    autoFilledClipboardTicket,
    busy,
    receiveDraftTicket,
    setAutoFilledClipboardTicket,
    setReceiveDraftTicket,
  ]);

  useEffect(() => {
    const onFocus = () => {
      void fillFromClipboard();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, [fillFromClipboard]);

  useEffect(() => {
    return () => {
      if (
        receiveDraftTicket &&
        receiveDraftTicket === autoFilledClipboardTicket &&
        receiveDraftTicket !== autoPreviewedClipboardTicket
      ) {
        setReceiveDraftTicket("");
      }
    };
  }, [
    autoFilledClipboardTicket,
    autoPreviewedClipboardTicket,
    receiveDraftTicket,
    setReceiveDraftTicket,
  ]);

}
