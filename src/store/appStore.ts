import { create } from "zustand";
import { type FileEntry, type Package, type Settings } from "../types/domain";

type TransferPeerConnectedEvent = {
  sessionId: string;
  packageId: string;
  peerId: string;
};

type TransferProgressEvent = {
  sessionId: string;
  packageId: string;
  transferredBytes: number;
  totalBytes: number;
  fileName?: string;
};

type TransferCompletedEvent = {
  sessionId: string;
  packageId: string;
  downloadDir?: string;
};

type TransferErrorEvent = {
  sessionId: string;
  packageId?: string;
  code: string;
  message: string;
};

type AppState = {
  packages: Package[];
  settings: Settings;
  receiveDraftTicket: string;
  autoPreviewedClipboardTicket: string | null;
  autoFilledClipboardTicket: string | null;
  setReceiveDraftTicket: (ticket: string) => void;
  setAutoPreviewedClipboardTicket: (ticket: string | null) => void;
  setAutoFilledClipboardTicket: (ticket: string | null) => void;
  updateTheme: (theme: Settings["theme"]) => void;
  updateDownloadDir: (downloadDir: string) => void;
  updateAutoDownloadMaxBytes: (bytes: number) => void;
  updateAutoInstallUpdates: (enabled: boolean) => void;
  updateSizeUnit: (unit: Settings["sizeUnit"]) => void;
  createSendDraftPackage: (input: {
    sourcePaths: string[];
    files: FileEntry[];
    selectedRoots?: string[];
  }) => string;
  createReceivePreviewPackage: (input: {
    packageId: string;
    ticket: string;
    files: FileEntry[];
    totalSizeBytes: number;
  }) => string;
  addFilesToPackage: (input: {
    packageId: string;
    files: FileEntry[];
    selectedRoots?: string[];
  }) => void;
  attachTicketToPackage: (input: {
    packageId: string;
    sessionId: string;
    backendPackageId: string;
    ticket: string;
  }) => void;
  attachReceiveSession: (input: {
    packageId: string;
    sessionId: string;
  }) => void;
  removeFileFromPackage: (input: { packageId: string; fileId: string }) => void;
  removeFilesFromPackage: (input: { packageId: string; fileIds: string[] }) => void;
  markCancelledBySession: (sessionId: string) => void;
  applyPeerConnectedEvent: (event: TransferPeerConnectedEvent) => void;
  applyProgressEvent: (event: TransferProgressEvent) => void;
  applyCompletedEvent: (event: TransferCompletedEvent) => void;
  applyErrorEvent: (event: TransferErrorEvent) => void;
};

const initialSettings: Settings = {
  downloadDir: "",
  theme: "system",
  autoDownloadMaxBytes: 1024 * 1024 * 1024,
  autoInstallUpdates: true,
  sizeUnit: "jedec",
};

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix: string) {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${random}`;
}

export const useAppStore = create<AppState>((set) => ({
  packages: [],
  settings: initialSettings,
  receiveDraftTicket: "",
  autoPreviewedClipboardTicket: null,
  autoFilledClipboardTicket: null,
  setReceiveDraftTicket: (receiveDraftTicket) => set({ receiveDraftTicket }),
  setAutoPreviewedClipboardTicket: (autoPreviewedClipboardTicket) =>
    set({ autoPreviewedClipboardTicket }),
  setAutoFilledClipboardTicket: (autoFilledClipboardTicket) =>
    set({ autoFilledClipboardTicket }),
  updateTheme: (theme) =>
    set((state) => ({ settings: { ...state.settings, theme } })),
  updateDownloadDir: (downloadDir) =>
    set((state) => ({ settings: { ...state.settings, downloadDir } })),
  updateAutoDownloadMaxBytes: (bytes) =>
    set((state) => ({
      settings: {
        ...state.settings,
        autoDownloadMaxBytes: bytes < 0 ? -1 : Math.max(0, bytes),
      },
    })),
  updateAutoInstallUpdates: (autoInstallUpdates) =>
    set((state) => ({ settings: { ...state.settings, autoInstallUpdates } })),
  updateSizeUnit: (sizeUnit) =>
    set((state) => ({ settings: { ...state.settings, sizeUnit } })),
  createSendDraftPackage: ({ sourcePaths, files, selectedRoots }) => {
    const packageId = createId("send");
    const totalSizeBytes = files.reduce((acc, file) => acc + file.sizeBytes, 0);

    set((state) => ({
      packages: [
        {
          id: packageId,
          mode: "send",
          sourcePaths,
          selectedRoots,
          files,
          totalSizeBytes,
          transferredBytes: 0,
          status: "idle",
          createdAtIso: nowIso(),
        },
        ...state.packages,
      ],
    }));

    return packageId;
  },
  createReceivePreviewPackage: ({ packageId, ticket, files, totalSizeBytes }): string => {
    const localId = createId("recv");
    let resolvedId = localId;
    set((state) => {
      const existing = state.packages.find(
        (pkg) =>
          pkg.mode === "receive" &&
          (pkg.backendPackageId === packageId || pkg.id === packageId),
      );

      if (existing) {
        resolvedId = existing.id;
        return state;
      }

      return {
        packages: [
          {
            id: localId,
            backendPackageId: packageId,
            mode: "receive",
          files,
          totalSizeBytes,
            transferredBytes: 0,
            ticket,
            status: "idle",
            createdAtIso: nowIso(),
          },
          ...state.packages,
        ],
      };
    });
    return resolvedId;
  },
  addFilesToPackage: ({ packageId, files, selectedRoots }) => {
    if (files.length === 0) {
      return;
    }

    set((state) => ({
      packages: state.packages.map((pkg) => {
        if (pkg.id !== packageId) {
          return pkg;
        }

        const existingPaths = new Set(
          pkg.files.map((file) => file.sourcePath).filter((path): path is string => Boolean(path)),
        );
        const nextFiles = [...pkg.files];
        for (const file of files) {
          if (file.sourcePath && existingPaths.has(file.sourcePath)) {
            continue;
          }
          nextFiles.push(file);
          if (file.sourcePath) {
            existingPaths.add(file.sourcePath);
          }
        }

        const totalSizeBytes = nextFiles.reduce((acc, file) => acc + file.sizeBytes, 0);
        const sourcePaths = pkg.sourcePaths
          ? nextFiles
              .map((file) => file.sourcePath)
              .filter((path): path is string => Boolean(path))
          : pkg.sourcePaths;

        let mergedRoots = pkg.selectedRoots;
        if (selectedRoots && selectedRoots.length > 0) {
          const rootSet = new Set(mergedRoots ?? []);
          for (const root of selectedRoots) {
            rootSet.add(root);
          }
          mergedRoots = Array.from(rootSet);
        }

        return {
          ...pkg,
          files: nextFiles,
          totalSizeBytes,
          sourcePaths,
          selectedRoots: mergedRoots,
        };
      }),
    }));
  },
  attachTicketToPackage: ({ packageId, sessionId, backendPackageId, ticket }) => {
    set((state) => ({
      packages: state.packages.map((pkg) =>
        pkg.id === packageId
          ? {
              ...pkg,
              backendPackageId,
              sessionId,
              ticket,
              status: "waiting_peer",
              transferredBytes: 0,
            }
          : pkg,
      ),
    }));
  },
  attachReceiveSession: ({ packageId, sessionId }) => {
    set((state) => ({
      packages: state.packages.map((pkg) =>
        pkg.id === packageId
          ? (() => {
              if (
                pkg.status === "completed" ||
                pkg.status === "failed"
              ) {
                return {
                  ...pkg,
                  sessionId,
                };
              }
              return {
                ...pkg,
                sessionId,
                status: "transferring",
                transferredBytes: pkg.status === "cancelled" ? 0 : (pkg.transferredBytes ?? 0),
              };
            })()
          : pkg,
      ),
    }));
  },
  removeFileFromPackage: ({ packageId, fileId }) => {
    set((state) => ({
      packages: state.packages.map((pkg) => {
        if (pkg.id !== packageId) {
          return pkg;
        }

        const files = pkg.files.filter((file) => file.id !== fileId);
        const totalSizeBytes = files.reduce((acc, file) => acc + file.sizeBytes, 0);
        const sourcePaths = pkg.sourcePaths
          ? files
              .map((file) => file.sourcePath)
              .filter((path): path is string => Boolean(path))
          : pkg.sourcePaths;

        return {
          ...pkg,
          files,
          totalSizeBytes,
          sourcePaths,
        };
      }),
    }));
  },
  removeFilesFromPackage: ({ packageId, fileIds }) => {
    if (fileIds.length === 0) {
      return;
    }
    const fileIdSet = new Set(fileIds);
    set((state) => ({
      packages: state.packages.map((pkg) => {
        if (pkg.id !== packageId) {
          return pkg;
        }

        const files = pkg.files.filter((file) => !fileIdSet.has(file.id));
        const totalSizeBytes = files.reduce((acc, file) => acc + file.sizeBytes, 0);
        const sourcePaths = pkg.sourcePaths
          ? files
              .map((file) => file.sourcePath)
              .filter((path): path is string => Boolean(path))
          : pkg.sourcePaths;

        return {
          ...pkg,
          files,
          totalSizeBytes,
          sourcePaths,
        };
      }),
    }));
  },
  markCancelledBySession: (sessionId) => {
    set((state) => ({
      packages: state.packages.map((pkg) =>
        pkg.sessionId === sessionId
          ? {
              ...pkg,
              status: "cancelled",
            }
          : pkg,
      ),
    }));
  },
  applyPeerConnectedEvent: ({ sessionId, peerId }) => {
    set((state) => ({
      packages: state.packages.map((pkg) =>
        pkg.sessionId === sessionId
          ? {
              ...pkg,
              peerId,
              status: pkg.status === "idle" ? "waiting_peer" : pkg.status,
            }
          : pkg,
      ),
    }));
  },
  applyProgressEvent: ({ sessionId, packageId, transferredBytes, totalBytes }) => {
    set((state) => ({
      packages: state.packages.map((pkg) =>
        pkg.sessionId === sessionId ||
        pkg.backendPackageId === packageId ||
        pkg.id === packageId
          ? (() => {
              if (
                pkg.status === "completed" ||
                pkg.status === "failed" ||
                pkg.status === "cancelled"
              ) {
                return pkg;
              }
              const done = transferredBytes >= totalBytes;
              return {
                ...pkg,
                totalSizeBytes: totalBytes,
                transferredBytes,
                status: done ? "completed" : "transferring",
              };
            })()
          : pkg,
      ),
    }));
  },
  applyCompletedEvent: ({ sessionId, packageId, downloadDir }) => {
    set((state) => ({
      packages: state.packages.map((pkg) =>
        pkg.sessionId === sessionId ||
        pkg.backendPackageId === packageId ||
        pkg.id === packageId
          ? {
              ...pkg,
              status: "completed",
              transferredBytes: pkg.totalSizeBytes,
              downloadDir: downloadDir ?? pkg.downloadDir,
            }
          : pkg,
      ),
    }));
  },
  applyErrorEvent: ({ sessionId, packageId }) => {
    set((state) => ({
      packages: state.packages.map((pkg) =>
        pkg.sessionId === sessionId ||
        (packageId !== undefined &&
          (pkg.backendPackageId === packageId || pkg.id === packageId))
          ? {
              ...pkg,
              status: "failed",
            }
          : pkg,
      ),
    }));
  },
}));
