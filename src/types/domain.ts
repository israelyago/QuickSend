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
  ticket?: string;
  downloadDir?: string;
  createdAtIso: string;
};

export type Settings = {
  downloadDir: string;
  theme: "light" | "dark" | "system";
  autoDownloadMaxBytes: number;
  autoInstallUpdates: boolean;
  sizeUnit: "jedec" | "iec";
};
