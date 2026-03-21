import { render, screen } from "@testing-library/react";
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

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { SendPage } from "./SendPage";
import { PackagePage } from "./PackagePage";
import { resetAppStoreForTest } from "../test/helpers/store";
import { mockTauriInvoke } from "../test/helpers/tauri";

describe("Send -> Package visual flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAppStoreForTest();
    vi.mocked(open).mockResolvedValue("/tmp/demo.txt");
    mockTauriInvoke(({ command }) => {
      if (command === "inspect_files") {
        return [
          {
            path: "/tmp/demo.txt",
            name: "demo.txt",
            sizeBytes: 1024,
            mimeType: "text/plain",
          },
        ];
      }
      return null;
    });
  });

  it("shows file list table after selecting a file", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/send"]}>
        <Routes>
          <Route path="/send" element={<SendPage />} />
          <Route path="/package/:id" element={<PackagePage />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /drag and drop files here/i }));

    expect(vi.mocked(open)).toHaveBeenCalled();
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("inspect_files", {
      files: ["/tmp/demo.txt"],
    });

    expect(await screen.findByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "File size" })).toBeInTheDocument();
    expect(screen.getByText("demo.txt")).toBeInTheDocument();

    const table = screen.getByRole("table");
    expect(table).toMatchSnapshot();
  });
});
