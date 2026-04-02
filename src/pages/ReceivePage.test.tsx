import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../store/appStore";
import { renderReceivePage, PACKAGE_ROUTE_TEST_ID } from "../test/helpers/receivePageHarness";
import { resetAppStoreForTest } from "../test/helpers/store";
import { mockTauriInvoke } from "../test/helpers/tauri";

describe("ReceivePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAppStoreForTest();
    mockTauriInvoke();
  });

  it("disables Download when ticket is empty and enables when filled", async () => {
    const user = userEvent.setup();
    renderReceivePage();

    const previewButton = screen.getByRole("button", { name: "Download" });
    const ticketInput = screen.getByPlaceholderText(/quicksend:\/\/receive/i);

    expect(previewButton).toBeDisabled();
    expect(invoke).toHaveBeenCalledWith("clipboard_ticket");

    await user.type(ticketInput, "blob:example-ticket");

    expect(previewButton).toBeEnabled();
  });

  it("previews a ticket and navigates to the package page", async () => {
    const user = userEvent.setup();
    mockTauriInvoke(({ command }) => {
      if (command === "package_preview") {
        return {
          packageId: "pkg-backend-1",
          files: [
            {
              name: "example.txt",
              sizeBytes: 42,
              mimeType: "text/plain",
            },
          ],
          totalSizeBytes: 42,
        };
      }
      return null;
    });

    renderReceivePage({ includePackageRoute: true });

    await user.type(screen.getByPlaceholderText(/quicksend:\/\/receive/i), "blob:flow-test");
    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(await screen.findByTestId(PACKAGE_ROUTE_TEST_ID)).toHaveTextContent(/^recv-/);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("package_preview", {
      ticket: "blob:flow-test",
    });
    expect(useAppStore.getState().receiveDraftTicket).toBe("");
  });
});
