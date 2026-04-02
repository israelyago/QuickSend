import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: vi.fn(async () => () => {}),
  }),
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: vi.fn(async () => undefined),
}));

import { invoke } from "@tauri-apps/api/core";
import { ReceivePage } from "./ReceivePage";
import { ReceivePackagePage } from "./ReceivePackagePage";
import { TEST_DOWNLOAD_DIR, TEST_TRANSFER_OUTPUT_DIR } from "../test/helpers/paths";
import { resetAppStoreForTest } from "../test/helpers/store";
import { mockTauriInvoke } from "../test/helpers/tauri";
import { useAppStore } from "../store/appStore";
import { formatBytes } from "../lib/formatters";

describe("Receive download UI flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAppStoreForTest();

    mockTauriInvoke(({ command }) => {
      if (command === "package_preview") {
        return {
          packageId: "pkg-recv-1",
          files: [
            {
              name: "movie.mkv",
              sizeBytes: 2048,
              mimeType: "video/x-matroska",
            },
          ],
          totalSizeBytes: 2048,
        };
      }

      if (command === "package_download") {
        return {
          sessionId: "recv-session-1",
          packageId: "pkg-recv-1",
        };
      }

      return null;
    });
  });

  it("shows downloading progress section and then completed state", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/receive"]}>
        <Routes>
          <Route path="/receive" element={<ReceivePage />} />
          <Route path="/receive/:id" element={<ReceivePackagePage />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.type(screen.getByPlaceholderText(/quicksend:\/\/receive/i), "blob:ticket-recv-flow");
    await user.click(screen.getByRole("button", { name: "Download" }));

    const downloadButton = await screen.findByRole("button", { name: "Download All" });
    await user.click(downloadButton);

    expect(vi.mocked(invoke)).toHaveBeenCalledWith("package_download", {
      ticket: "blob:ticket-recv-flow",
      packageId: "pkg-recv-1",
      downloadDir: TEST_DOWNLOAD_DIR,
    });

    expect(await screen.findByRole("button", { name: "Cancel Download" })).toBeInTheDocument();

    act(() => {
      useAppStore.getState().applyProgressEvent({
        sessionId: "recv-session-1",
        packageId: "pkg-recv-1",
        transferredBytes: 1024,
        totalBytes: 2048,
      });
    });

    expect(screen.getByText(formatBytes(1024, "jedec"))).toBeInTheDocument();
    expect(screen.getByText(formatBytes(2048, "jedec"))).toBeInTheDocument();

    act(() => {
      useAppStore.getState().applyCompletedEvent({
        sessionId: "recv-session-1",
        packageId: "pkg-recv-1",
        downloadDir: TEST_TRANSFER_OUTPUT_DIR,
      });
    });

    expect(await screen.findByRole("button", { name: "Open Files" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel Download" })).not.toBeInTheDocument();
    expect(screen.getByText(/Download Complete!/i)).toBeInTheDocument();
  });
});
