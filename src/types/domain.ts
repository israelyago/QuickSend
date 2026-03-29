export type TransferStatus =
  | "idle"
  | "preparing"
  | "waiting_peer"
  | "transferring"
  | "completed"
  | "failed"
  | "cancelled";

export type FileEntry = {
  id: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  sourcePath?: string;
  prepareBackendFileId?: string;
  prepareStatus?: "queued" | "importing" | "verifying" | "completed" | "failed" | "cancelled";
  prepareProcessedBytes?: number;
  prepareError?: string;
};

export type Package = {
  id: string;
  mode: "send" | "receive";
  files: FileEntry[];
  sourcePaths?: string[];
  selectedRoots?: string[];
  sessionId?: string;
  backendPackageId?: string;
  totalSizeBytes: number;
  transferredBytes?: number;
  peerId?: string;
  status: TransferStatus;
  prepareSessionId?: string;
  prepareStatus?: "idle" | "preparing" | "completed" | "failed" | "cancelled";
  prepareProgress?: {
    completedFiles: number;
    failedFiles: number;
    cancelledFiles: number;
    totalFiles: number;
    processedBytes: number;
    totalBytes: number;
  };
  ticket?: string;
  downloadDir?: string;
  prepareSequence?: number;
  createdAtIso: string;
};

export type Settings = {
  downloadDir: string;
  theme: "light" | "dark" | "system";
  autoDownloadMaxBytes: number;
  autoInstallUpdates: boolean;
  sizeUnit: "jedec" | "iec";
};
