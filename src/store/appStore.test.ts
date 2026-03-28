import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./appStore";
import { type FileEntry } from "../types/domain";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore() {
  useAppStore.setState({
    packages: [],
    settings: {
      downloadDir: "/tmp/test-downloads",
      theme: "system",
      autoDownloadMaxBytes: 1024 * 1024 * 1024,
      autoInstallUpdates: true,
      sizeUnit: "jedec",
    },
    receiveDraftTicket: "",
    autoPreviewedClipboardTicket: null,
    autoFilledClipboardTicket: null,
  });
}

function makeFile(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    id: "fe-1",
    name: "a.txt",
    sizeBytes: 1024,
    mimeType: "text/plain",
    sourcePath: "/tmp/a.txt",
    ...overrides,
  };
}

function makePrepareProgressEvent(
  prepareSessionId: string,
  packageId: string,
  overrides: Partial<{
    status: "queued" | "running" | "completed" | "failed" | "cancelled";
    files: {
      fileId: string;
      name: string;
      path: string;
      status: "queued" | "importing" | "verifying" | "completed" | "failed" | "cancelled";
      processedBytes: number;
      totalBytes: number;
      error?: string;
    }[];
    summary: {
      totalFiles: number;
      completedFiles: number;
      failedFiles: number;
      cancelledFiles: number;
      processedBytes: number;
      totalBytes: number;
    };
    sequence: number;
    done: boolean;
    changedFileIds: string[];
  }> = {},
) {
  return {
    prepareSessionId,
    packageId,
    status: "running" as const,
    summary: {
      totalFiles: 1,
      completedFiles: 0,
      failedFiles: 0,
      cancelledFiles: 0,
      processedBytes: 0,
      totalBytes: 1024,
    },
    files: [],
    sequence: 1,
    done: false,
    changedFileIds: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Reducer integration for progress events
// ---------------------------------------------------------------------------

describe("applySendPrepareProgressEvent", () => {
  beforeEach(resetStore);

  it("updates file prepareStatus when a matching file is in the event", () => {
    const store = useAppStore.getState();
    const file = makeFile({ id: "fe-1", name: "a.txt", sourcePath: "/tmp/a.txt", sizeBytes: 1024 });
    const pkgId = store.createSendDraftPackage({ sourcePaths: ["/tmp/a.txt"], files: [file] });
    store.startPackagePrepare({ packageId: pkgId, prepareSessionId: "ps-1" });

    useAppStore.getState().applySendPrepareProgressEvent(
      makePrepareProgressEvent("ps-1", "backend-pkg-1", {
        status: "running",
        files: [
          {
            fileId: "f0",
            name: "a.txt",
            path: "/tmp/a.txt",
            status: "importing",
            processedBytes: 512,
            totalBytes: 1024,
          },
        ],
        changedFileIds: ["f0"],
      }),
    );

    const pkg = useAppStore.getState().packages.find((p) => p.id === pkgId);
    expect(pkg).toBeDefined();
    const updatedFile = pkg!.files.find((f) => f.name === "a.txt");
    expect(updatedFile?.prepareStatus).toBe("importing");
    expect(updatedFile?.prepareProcessedBytes).toBe(512);
    expect(updatedFile?.prepareBackendFileId).toBe("f0");
  });

  it("does not touch files that are not mentioned in the event", () => {
    const store = useAppStore.getState();
    const fileA = makeFile({ id: "fe-1", name: "a.txt", sourcePath: "/tmp/a.txt", sizeBytes: 512 });
    const fileB = makeFile({ id: "fe-2", name: "b.txt", sourcePath: "/tmp/b.txt", sizeBytes: 256 });
    const pkgId = store.createSendDraftPackage({
      sourcePaths: ["/tmp/a.txt", "/tmp/b.txt"],
      files: [fileA, fileB],
    });
    store.startPackagePrepare({ packageId: pkgId, prepareSessionId: "ps-2" });

    useAppStore.getState().applySendPrepareProgressEvent(
      makePrepareProgressEvent("ps-2", "backend-pkg-2", {
        files: [
          {
            fileId: "f0",
            name: "a.txt",
            path: "/tmp/a.txt",
            status: "completed",
            processedBytes: 512,
            totalBytes: 512,
          },
        ],
        changedFileIds: ["f0"],
      }),
    );

    const pkg = useAppStore.getState().packages.find((p) => p.id === pkgId)!;
    const bFile = pkg.files.find((f) => f.name === "b.txt");
    // b.txt was not in changedFileIds – its prepareStatus stays "queued"
    expect(bFile?.prepareStatus).toBe("queued");
  });

  it("maps session-level failed status to package status=failed", () => {
    const store = useAppStore.getState();
    const file = makeFile();
    const pkgId = store.createSendDraftPackage({ sourcePaths: ["/tmp/a.txt"], files: [file] });
    store.startPackagePrepare({ packageId: pkgId, prepareSessionId: "ps-3" });

    useAppStore.getState().applySendPrepareProgressEvent(
      makePrepareProgressEvent("ps-3", "backend-pkg-3", {
        status: "failed",
        done: true,
      }),
    );

    const pkg = useAppStore.getState().packages.find((p) => p.id === pkgId)!;
    expect(pkg.status).toBe("failed");
    expect(pkg.prepareStatus).toBe("failed");
  });

  it("maps session-level cancelled status to package status=cancelled", () => {
    const store = useAppStore.getState();
    const file = makeFile();
    const pkgId = store.createSendDraftPackage({ sourcePaths: ["/tmp/a.txt"], files: [file] });
    store.startPackagePrepare({ packageId: pkgId, prepareSessionId: "ps-4" });

    useAppStore.getState().applySendPrepareProgressEvent(
      makePrepareProgressEvent("ps-4", "backend-pkg-4", {
        status: "cancelled",
        done: true,
      }),
    );

    const pkg = useAppStore.getState().packages.find((p) => p.id === pkgId)!;
    expect(pkg.status).toBe("cancelled");
    expect(pkg.prepareStatus).toBe("cancelled");
  });

  it("ignores events for unknown prepareSessionId", () => {
    const store = useAppStore.getState();
    const file = makeFile();
    const pkgId = store.createSendDraftPackage({ sourcePaths: ["/tmp/a.txt"], files: [file] });
    store.startPackagePrepare({ packageId: pkgId, prepareSessionId: "ps-5" });

    useAppStore.getState().applySendPrepareProgressEvent(
      makePrepareProgressEvent("unknown-session", "backend-pkg-5", {
        status: "failed",
        done: true,
      }),
    );

    // Package should be unchanged (still preparing from startPackagePrepare)
    const pkg = useAppStore.getState().packages.find((p) => p.id === pkgId)!;
    expect(pkg.status).toBe("preparing");
  });
});

// ---------------------------------------------------------------------------
// Add/remove file consistency for package-level counters
// ---------------------------------------------------------------------------

describe("addFilesToPackage / removeFileFromPackage – counter consistency", () => {
  beforeEach(resetStore);

  it("addFilesToPackage increases totalSizeBytes by the new file sizes", () => {
    const store = useAppStore.getState();
    const fileA = makeFile({ id: "fe-1", name: "a.txt", sizeBytes: 1000, sourcePath: "/tmp/a.txt" });
    const pkgId = store.createSendDraftPackage({ sourcePaths: ["/tmp/a.txt"], files: [fileA] });

    const fileB = makeFile({ id: "fe-2", name: "b.txt", sizeBytes: 500, sourcePath: "/tmp/b.txt" });
    useAppStore.getState().addFilesToPackage({ packageId: pkgId, files: [fileB] });

    const pkg = useAppStore.getState().packages.find((p) => p.id === pkgId)!;
    expect(pkg.totalSizeBytes).toBe(1500);
    expect(pkg.files).toHaveLength(2);
  });

  it("addFilesToPackage deduplicates files with the same sourcePath", () => {
    const store = useAppStore.getState();
    const fileA = makeFile({ id: "fe-1", name: "a.txt", sizeBytes: 1000, sourcePath: "/tmp/a.txt" });
    const pkgId = store.createSendDraftPackage({ sourcePaths: ["/tmp/a.txt"], files: [fileA] });

    // Add the exact same file again
    const fileADup = makeFile({ id: "fe-1-dup", name: "a.txt", sizeBytes: 1000, sourcePath: "/tmp/a.txt" });
    useAppStore.getState().addFilesToPackage({ packageId: pkgId, files: [fileADup] });

    const pkg = useAppStore.getState().packages.find((p) => p.id === pkgId)!;
    expect(pkg.files).toHaveLength(1);
    expect(pkg.totalSizeBytes).toBe(1000);
  });

  it("removeFileFromPackage decreases totalSizeBytes correctly", () => {
    const store = useAppStore.getState();
    const fileA = makeFile({ id: "fe-1", name: "a.txt", sizeBytes: 800, sourcePath: "/tmp/a.txt" });
    const fileB = makeFile({ id: "fe-2", name: "b.txt", sizeBytes: 400, sourcePath: "/tmp/b.txt" });
    const pkgId = store.createSendDraftPackage({
      sourcePaths: ["/tmp/a.txt", "/tmp/b.txt"],
      files: [fileA, fileB],
    });

    useAppStore.getState().removeFileFromPackage({ packageId: pkgId, fileId: "fe-1" });

    const pkg = useAppStore.getState().packages.find((p) => p.id === pkgId)!;
    expect(pkg.totalSizeBytes).toBe(400);
    expect(pkg.files).toHaveLength(1);
    expect(pkg.files[0].id).toBe("fe-2");
  });

  it("prepareProgress.totalFiles stays consistent after addFilesToPackage during prepare", () => {
    const store = useAppStore.getState();
    const fileA = makeFile({ id: "fe-1", name: "a.txt", sizeBytes: 500, sourcePath: "/tmp/a.txt" });
    const pkgId = store.createSendDraftPackage({ sourcePaths: ["/tmp/a.txt"], files: [fileA] });
    useAppStore.getState().startPackagePrepare({ packageId: pkgId, prepareSessionId: "ps-add" });

    const fileB = makeFile({ id: "fe-2", name: "b.txt", sizeBytes: 300, sourcePath: "/tmp/b.txt" });
    useAppStore.getState().addFilesToPackage({ packageId: pkgId, files: [fileB] });

    const pkg = useAppStore.getState().packages.find((p) => p.id === pkgId)!;
    // prepareProgress is recalculated from the updated file list during an active prepare
    expect(pkg.prepareProgress?.totalFiles).toBe(2);
    expect(pkg.prepareProgress?.totalBytes).toBe(800);
  });

  it("prepareProgress counters stay consistent after removeFileFromPackage during prepare", () => {
    const store = useAppStore.getState();
    const fileA = makeFile({ id: "fe-1", name: "a.txt", sizeBytes: 600, sourcePath: "/tmp/a.txt" });
    const fileB = makeFile({ id: "fe-2", name: "b.txt", sizeBytes: 400, sourcePath: "/tmp/b.txt" });
    const pkgId = store.createSendDraftPackage({
      sourcePaths: ["/tmp/a.txt", "/tmp/b.txt"],
      files: [fileA, fileB],
    });
    useAppStore.getState().startPackagePrepare({ packageId: pkgId, prepareSessionId: "ps-rem" });

    useAppStore.getState().removeFileFromPackage({ packageId: pkgId, fileId: "fe-1" });

    const pkg = useAppStore.getState().packages.find((p) => p.id === pkgId)!;
    expect(pkg.files).toHaveLength(1);
    // prepareProgress is rebuilt from surviving files
    expect(pkg.prepareProgress?.totalFiles).toBe(1);
    expect(pkg.prepareProgress?.totalBytes).toBe(400);
  });

  it("removeFilesFromPackage removes multiple files atomically", () => {
    const store = useAppStore.getState();
    const files = [
      makeFile({ id: "fe-1", name: "a.txt", sizeBytes: 100, sourcePath: "/tmp/a.txt" }),
      makeFile({ id: "fe-2", name: "b.txt", sizeBytes: 200, sourcePath: "/tmp/b.txt" }),
      makeFile({ id: "fe-3", name: "c.txt", sizeBytes: 300, sourcePath: "/tmp/c.txt" }),
    ];
    const pkgId = store.createSendDraftPackage({
      sourcePaths: files.map((f) => f.sourcePath!),
      files,
    });

    useAppStore.getState().removeFilesFromPackage({ packageId: pkgId, fileIds: ["fe-1", "fe-3"] });

    const pkg = useAppStore.getState().packages.find((p) => p.id === pkgId)!;
    expect(pkg.files).toHaveLength(1);
    expect(pkg.files[0].id).toBe("fe-2");
    expect(pkg.totalSizeBytes).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Small-file fast-complete reconciliation
// ---------------------------------------------------------------------------

describe("markSendPrepareCompleted – fast-complete reconciliation", () => {
  beforeEach(resetStore);

  it("marks non-terminal files as completed with processedBytes = sizeBytes", () => {
    const store = useAppStore.getState();
    const file = makeFile({ id: "fe-1", name: "a.txt", sizeBytes: 128, sourcePath: "/tmp/a.txt" });
    const pkgId = store.createSendDraftPackage({ sourcePaths: ["/tmp/a.txt"], files: [file] });
    useAppStore.getState().startPackagePrepare({ packageId: pkgId, prepareSessionId: "ps-fc1" });

    // Simulate a fast small file: the prepare-completed event fires before any
    // progress event reached the store.
    useAppStore.getState().markSendPrepareCompleted("ps-fc1");

    const pkg = useAppStore.getState().packages.find((p) => p.id === pkgId)!;
    const updatedFile = pkg.files[0];
    expect(updatedFile.prepareStatus).toBe("completed");
    expect(updatedFile.prepareProcessedBytes).toBe(128); // sizeBytes
    expect(updatedFile.prepareError).toBeUndefined();
    expect(pkg.prepareStatus).toBe("completed");
  });

  it("does not overwrite a file that is already in a terminal state", () => {
    const store = useAppStore.getState();
    const fileA = makeFile({ id: "fe-1", name: "a.txt", sizeBytes: 50, sourcePath: "/tmp/a.txt" });
    const fileB = makeFile({ id: "fe-2", name: "b.txt", sizeBytes: 75, sourcePath: "/tmp/b.txt" });
    const pkgId = store.createSendDraftPackage({
      sourcePaths: ["/tmp/a.txt", "/tmp/b.txt"],
      files: [fileA, fileB],
    });
    useAppStore.getState().startPackagePrepare({ packageId: pkgId, prepareSessionId: "ps-fc2" });

    // Manually put b.txt into "failed" state (terminal) to simulate a real error
    useAppStore.setState((state) => ({
      packages: state.packages.map((pkg) =>
        pkg.id !== pkgId
          ? pkg
          : {
              ...pkg,
              files: pkg.files.map((f) =>
                f.id === "fe-2" ? { ...f, prepareStatus: "failed" as const, prepareError: "disk error" } : f,
              ),
            },
      ),
    }));

    useAppStore.getState().markSendPrepareCompleted("ps-fc2");

    const pkg = useAppStore.getState().packages.find((p) => p.id === pkgId)!;
    const failed = pkg.files.find((f) => f.id === "fe-2")!;
    // Terminal state must be preserved
    expect(failed.prepareStatus).toBe("failed");
    expect(failed.prepareError).toBe("disk error");

    // Non-terminal a.txt gets promoted
    const completed = pkg.files.find((f) => f.id === "fe-1")!;
    expect(completed.prepareStatus).toBe("completed");
  });

  it("recalculates prepareProgress.completedFiles after fast-complete", () => {
    const store = useAppStore.getState();
    const files = [
      makeFile({ id: "fe-1", name: "a.txt", sizeBytes: 10, sourcePath: "/tmp/a.txt" }),
      makeFile({ id: "fe-2", name: "b.txt", sizeBytes: 20, sourcePath: "/tmp/b.txt" }),
    ];
    const pkgId = store.createSendDraftPackage({
      sourcePaths: files.map((f) => f.sourcePath!),
      files,
    });
    useAppStore.getState().startPackagePrepare({ packageId: pkgId, prepareSessionId: "ps-fc3" });

    useAppStore.getState().markSendPrepareCompleted("ps-fc3");

    const pkg = useAppStore.getState().packages.find((p) => p.id === pkgId)!;
    expect(pkg.prepareProgress?.completedFiles).toBe(2);
    expect(pkg.prepareProgress?.totalFiles).toBe(2);
    expect(pkg.prepareProgress?.processedBytes).toBe(30); // 10 + 20
  });

  it("does not affect packages with a different prepareSessionId", () => {
    const store = useAppStore.getState();
    const file = makeFile({ id: "fe-1", name: "a.txt", sizeBytes: 64, sourcePath: "/tmp/a.txt" });
    const pkgId1 = store.createSendDraftPackage({ sourcePaths: ["/tmp/a.txt"], files: [file] });
    const pkgId2 = store.createSendDraftPackage({
      sourcePaths: ["/tmp/a.txt"],
      files: [makeFile({ id: "fe-2", name: "a.txt", sizeBytes: 64, sourcePath: "/tmp/a.txt" })],
    });
    useAppStore.getState().startPackagePrepare({ packageId: pkgId1, prepareSessionId: "ps-fc4a" });
    useAppStore.getState().startPackagePrepare({ packageId: pkgId2, prepareSessionId: "ps-fc4b" });

    useAppStore.getState().markSendPrepareCompleted("ps-fc4a");

    const pkg2 = useAppStore.getState().packages.find((p) => p.id === pkgId2)!;
    // pkg2 should still be in "preparing" state
    expect(pkg2.prepareStatus).toBe("preparing");
    expect(pkg2.files[0].prepareStatus).toBe("queued");
  });
});
