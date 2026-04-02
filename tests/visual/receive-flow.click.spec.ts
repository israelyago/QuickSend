import { expect, test } from "@playwright/test";
import { TEST_DOWNLOAD_DIR, TEST_LOGS_DIR, TEST_TRANSFER_OUTPUT_DIR } from "../../src/test/helpers/paths";

test("receive flow click-click: preview -> download -> completed", async ({ page }) => {
  await page.addInitScript(({ testDownloadDir, testLogsDir }) => {
    type ListenerRecord = { event: string; handlerId: number };

    const callbacks = new Map<number, (payload: unknown) => void>();
    const listeners = new Map<number, ListenerRecord>();
    let nextCallbackId = 1;
    let nextEventId = 1;

    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
      transformCallback: (cb: (payload: unknown) => void) => {
        const id = nextCallbackId++;
        callbacks.set(id, cb);
        return id;
      },
      unregisterCallback: (id: number) => {
        callbacks.delete(id);
      },
      convertFileSrc: (path: string) => path,
      invoke: async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "settings_load") {
          return {
            downloadDir: testDownloadDir,
            theme: "system",
            autoDownloadMaxBytes: 0,
            autoInstallUpdates: true,
            sizeUnit: "jedec",
          };
        }
        if (cmd === "settings_save") return null;
        if (cmd === "clipboard_ticket") return null;
        if (cmd === "logs_dir") return testLogsDir;
        if (cmd === "open_logs_dir") return testLogsDir;

        if (cmd === "package_preview") {
          return {
            packageId: "pkg-ui-1",
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

        if (cmd === "package_download") {
          return {
            sessionId: "recv-session-ui-1",
            packageId: "pkg-ui-1",
          };
        }

        if (cmd === "plugin:event|listen") {
          const eventId = nextEventId++;
          const eventName = String(args.event ?? "");
          const handlerId = Number(args.handler);
          listeners.set(eventId, { event: eventName, handlerId });
          return eventId;
        }

        if (cmd === "plugin:event|unlisten") {
          const eventId = Number(args.eventId);
          listeners.delete(eventId);
          return null;
        }

        if (cmd === "transfer_cancel") {
          return null;
        }

        return null;
      },
    };

    (window as Window & { __TAURI_EVENT_PLUGIN_INTERNALS__?: unknown }).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: (_eventName: string, eventId: number) => {
        listeners.delete(eventId);
      },
    };

    (
      window as Window & {
        __emitMockEvent?: (eventName: string, payload: unknown) => void;
      }
    ).__emitMockEvent = (eventName: string, payload: unknown) => {
      for (const [eventId, entry] of listeners.entries()) {
        if (entry.event !== eventName) continue;
        const callback = callbacks.get(entry.handlerId);
        callback?.({ event: eventName, id: eventId, payload });
      }
    };
  }, { testDownloadDir: TEST_DOWNLOAD_DIR, testLogsDir: TEST_LOGS_DIR });

  await page.goto("/");

  await page.getByRole("link", { name: "Receive" }).click();
  await page.getByLabel("quicksend-link").fill("blob:ticket-playwright-flow");
  await page.getByRole("button", { name: "Download" }).click();

  await expect(page.getByRole("button", { name: "Download All" })).toBeVisible();
  await page.getByRole("button", { name: "Download All" }).click();
  await expect(page.getByRole("button", { name: "Cancel download" })).toBeVisible();

  await page.evaluate(() => {
    (
      window as unknown as Window & {
        __emitMockEvent: (eventName: string, payload: unknown) => void;
      }
    ).__emitMockEvent("transfer:progress", {
      sessionId: "recv-session-ui-1",
      packageId: "pkg-ui-1",
      transferredBytes: 1024,
      totalBytes: 2048,
    });
  });

  await expect(page.getByText("1.0 KB")).toBeVisible();
  await expect(page.getByText("50%")).toBeVisible();
  await expect(page.getByText("2.0 KB")).toBeVisible();

  await page.evaluate(({ testTransferOutputDir }) => {
    (
      window as unknown as Window & {
        __emitMockEvent: (eventName: string, payload: unknown) => void;
      }
    ).__emitMockEvent("transfer:completed", {
      sessionId: "recv-session-ui-1",
      packageId: "pkg-ui-1",
      downloadDir: testTransferOutputDir,
    });
  }, { testTransferOutputDir: TEST_TRANSFER_OUTPUT_DIR });

  await expect(page.getByRole("button", { name: "Open Files" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel download" })).toHaveCount(0);
});
