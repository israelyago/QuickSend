import { invoke } from "@tauri-apps/api/core";
import { vi } from "vitest";

export type InvokeHandler = (args: { command: string; payload: unknown }) => unknown | Promise<unknown>;

export function mockTauriInvoke(handler?: InvokeHandler) {
  vi.mocked(invoke).mockImplementation(async (command: string, payload?: unknown) => {
    if (handler) {
      return handler({ command, payload });
    }
    if (command === "clipboard_ticket") {
      return null;
    }
    return null;
  });
}

