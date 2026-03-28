import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PackagePageContent } from "./PackagePageContent";
import { type Package } from "../types/domain";

const defaultProps = {
  activeMenuId: null,
  activeRow: null,
  busy: false,
  canEditFiles: true,
  error: null,
  etaSeconds: null,
  filesLocked: false,
  isDragActive: false,
  menuPosition: null,
  progressPercent: 0,
  rateBps: null,
  rows: [],
  settings: {
    downloadDir: "/downloads",
    theme: "system" as const,
    autoDownloadMaxBytes: 0,
    autoInstallUpdates: false,
    sizeUnit: "jedec" as const,
  },
  onCancelDownload: vi.fn(),
  onSelectAdditionalFiles: vi.fn(),
  setActiveMenuId: vi.fn(),
  setActiveMenuRect: vi.fn(),
  removeFileFromPackage: vi.fn(),
  removeFilesFromPackage: vi.fn(),
  removePreparingFile: vi.fn(),
  formatBytes: (val: number) => `${val} B`,
  formatDuration: (sec: number) => `${sec}s`,
};

describe("PackagePageContent Progress Bar", () => {
  it("does not show the general progress bar when prepareStatus is completed", () => {
    const packageData = {
      id: "pkg-1",
      mode: "send",
      status: "preparing",
      totalSizeBytes: 100,
      files: [],
      createdAt: Date.now(),
      createdAtIso: new Date().toISOString(),
      prepareSessionId: "session-1",
      prepareStatus: "completed",
      prepareProgress: {
        totalFiles: 1,
        completedFiles: 1,
        failedFiles: 0,
        cancelledFiles: 0,
        totalBytes: 100,
        processedBytes: 100,
      },
    } as Package;

    render(<PackagePageContent {...defaultProps} packageData={packageData} />);

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

});
