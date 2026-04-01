import React from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import "../../index.css";
import { SendPackagePage } from "../../pages/SendPackagePage";
import { useAppStore } from "../../store/appStore";
import { TEST_DOWNLOAD_DIR, TEST_TRANSFER_OUTPUT_DIR } from "../helpers/paths";
import type { Package } from "../../types/domain";

type VisualState = "preview" | "downloading" | "completed";

function resolveStateFromQuery(): VisualState {
  const state = new URLSearchParams(window.location.search).get("state");
  if (state === "downloading" || state === "completed") {
    return state;
  }
  return "preview";
}

function buildReceivePackage(state: VisualState): Package {
  const base: Package = {
    id: "recv-visual",
    backendPackageId: "pkg-visual",
    mode: "receive",
    ticket: "blob:visual-receive-ticket",
    files: [
      {
        id: "f1",
        name: "movie.mkv",
        sizeBytes: 1024,
        mimeType: "video/x-matroska",
      },
      {
        id: "f2",
        name: "readme.txt",
        sizeBytes: 1024,
        mimeType: "text/plain",
      },
    ],
    totalSizeBytes: 2048,
    transferredBytes: 0,
    status: "idle",
    createdAtIso: "2026-01-01T00:00:00.000Z",
  };

  if (state === "downloading") {
    return {
      ...base,
      sessionId: "recv-session-visual",
      status: "transferring",
      transferredBytes: 1024,
    };
  }

  if (state === "completed") {
    return {
      ...base,
      sessionId: "recv-session-visual",
      status: "completed",
      transferredBytes: 2048,
      downloadDir: TEST_TRANSFER_OUTPUT_DIR,
    };
  }

  return base;
}

const state = resolveStateFromQuery();

useAppStore.setState({
  packages: [buildReceivePackage(state)],
  settings: {
    downloadDir: TEST_DOWNLOAD_DIR,
    theme: "light",
    autoDownloadMaxBytes: 1024 * 1024 * 1024,
    autoInstallUpdates: true,
    sizeUnit: "jedec",
  },
  receiveDraftTicket: "",
  autoPreviewedClipboardTicket: null,
  autoFilledClipboardTicket: null,
});

ReactDOM.createRoot(document.getElementById("visual-root")!).render(
  <React.StrictMode>
    <div className="min-h-screen bg-background p-8 text-foreground">
      <div className="mx-auto max-w-5xl">
        <MemoryRouter initialEntries={["/package/recv-visual"]}>
          <Routes>
            <Route path="/package/:id" element={<SendPackagePage />} />
          </Routes>
        </MemoryRouter>
      </div>
    </div>
  </React.StrictMode>,
);
