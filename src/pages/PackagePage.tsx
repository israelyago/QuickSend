import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useParams } from "react-router-dom";
import { useAppStore } from "../store/appStore";
import {
  CloudDownload,
  Copy,
  Folder,
  FolderOpen,
  Gauge,
  Hourglass,
  Lock,
  MoreHorizontal,
  OctagonX,
  Package,
  Trash2,
} from "lucide-react";
import { filesize } from "filesize";
import { toast } from "sonner";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip";
import { Progress } from "../components/ui/progress";
import { Field } from "../components/ui/field";
import { cn } from "../lib/utils";

function formatBytes(value: number, standard: "jedec" | "iec") {
  return filesize(value, { standard, round: 1, pad: true }) as string;
}

function formatDuration(seconds: number) {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const paddedMinutes = String(minutes).padStart(2, "0");
  const paddedSeconds = String(secs).padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${paddedMinutes}:${paddedSeconds}`;
  }
  return `${paddedMinutes}:${paddedSeconds}`;
}

type PackageCreateResponse = {
  sessionId: string;
  packageId: string;
  ticket: string;
};

type PackageDownloadResponse = {
  sessionId: string;
  packageId: string;
};

export function PackagePage() {
  const { id } = useParams<{ id: string }>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isGeneratingTicket, setIsGeneratingTicket] = useState(false);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [activeMenuRect, setActiveMenuRect] = useState<DOMRect | null>(null);
  const [rateBps, setRateBps] = useState<number | null>(null);
  const [lastProgress, setLastProgress] = useState<{
    bytes: number;
    timeMs: number;
  } | null>(null);
  const [lastUiUpdate, setLastUiUpdate] = useState<number>(0);
  const [autoDownloadTriggered, setAutoDownloadTriggered] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const packages = useAppStore((state) => state.packages);
  const settings = useAppStore((state) => state.settings);
  const attachTicketToPackage = useAppStore((state) => state.attachTicketToPackage);
  const attachReceiveSession = useAppStore((state) => state.attachReceiveSession);
  const markCancelledBySession = useAppStore((state) => state.markCancelledBySession);
  const removeFileFromPackage = useAppStore((state) => state.removeFileFromPackage);
  const removeFilesFromPackage = useAppStore((state) => state.removeFilesFromPackage);
  const addFilesToPackage = useAppStore((state) => state.addFilesToPackage);

  const pkg = useMemo(() => {
    if (id === "current") {
      return packages[0];
    }
    return packages.find((item) => item.id === id);
  }, [id, packages]);

  if (!pkg) {
    return (
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-slate-500 dark:text-zinc-400" aria-hidden="true" />
          <h2 className="text-2xl font-semibold">Package</h2>
        </div>
        <p className="text-sm text-red-600">Package not found for id: {id}</p>
      </section>
    );
  }
  const packageData = pkg;
  const canEditFiles =
    packageData.mode === "send" && !packageData.ticket && !isGeneratingTicket;
  const filesLocked = packageData.mode === "send" && !canEditFiles;
  type FileRow = { kind: "file"; id: string; file: typeof packageData.files[number] };
  type FolderRow = {
    kind: "folder";
    id: string;
    name: string;
    sizeBytes: number;
    fileCount: number;
    fileIds: string[];
  };

  const rows = useMemo<(FileRow | FolderRow)[]>(() => {
    const normalizePath = (value: string) => value.replace(/\\/g, "/");

    if (packageData.mode === "send" && packageData.selectedRoots?.length) {
      const filesWithPaths = packageData.files
        .map((file) => ({
          file,
          path: file.sourcePath ? normalizePath(file.sourcePath) : null,
        }))
        .filter((item) => item.path);

      const roots = packageData.selectedRoots
        .map((root) => normalizePath(root))
        .filter(Boolean);

      const candidateRoots = roots.filter((root) =>
        filesWithPaths.some((item) => item.path?.startsWith(`${root}/`)),
      );

      const dedupedRoots = candidateRoots
        .sort((a, b) => a.length - b.length)
        .filter(
          (root, index, arr) =>
            !arr.slice(0, index).some((parent) => root.startsWith(`${parent}/`)),
        );

      const folderRows: FolderRow[] = dedupedRoots.map((root) => {
        const fileIds = filesWithPaths
          .filter((item) => item.path?.startsWith(`${root}/`))
          .map((item) => item.file.id);
        const sizeBytes = filesWithPaths
          .filter((item) => item.path?.startsWith(`${root}/`))
          .reduce((acc, item) => acc + item.file.sizeBytes, 0);
        const name = root.split("/").filter(Boolean).pop() ?? root;
        return {
          kind: "folder",
          id: `folder:${root}`,
          name,
          sizeBytes,
          fileCount: fileIds.length,
          fileIds,
        };
      });

      const folderRootSet = new Set(dedupedRoots);
      const fileRows: FileRow[] = packageData.files
        .filter((file) => {
          if (!file.sourcePath) {
            return true;
          }
          const path = normalizePath(file.sourcePath);
          for (const root of folderRootSet) {
            if (path.startsWith(`${root}/`)) {
              return false;
            }
          }
          return true;
        })
        .map((file) => ({ kind: "file", id: file.id, file }));

      return [...folderRows, ...fileRows];
    }

    if (packageData.mode === "receive") {
      const folders = new Map<string, FolderRow>();
      const fileRows: FileRow[] = [];

      for (const file of packageData.files) {
        if (file.name.includes("/")) {
          const normalized = normalizePath(file.name);
          const [root, ...rest] = normalized.split("/");
          if (root && rest.length > 0) {
            const key = root;
            const existing = folders.get(key);
            if (existing) {
              existing.sizeBytes += file.sizeBytes;
              existing.fileCount += 1;
              existing.fileIds.push(file.id);
            } else {
              folders.set(key, {
                kind: "folder",
                id: `folder:${key}`,
                name: key,
                sizeBytes: file.sizeBytes,
                fileCount: 1,
                fileIds: [file.id],
              });
            }
            continue;
          }
        }
        fileRows.push({ kind: "file", id: file.id, file });
      }

      return [...folders.values(), ...fileRows];
    }

    return packageData.files.map((file) => ({
      kind: "file",
      id: file.id,
      file,
    }));
  }, [packageData.files, packageData.mode, packageData.selectedRoots]);

  const activeRow = activeMenuId ? rows.find((row) => row.id === activeMenuId) : null;

  type LocalFileInfo = {
    path: string;
    name: string;
    sizeBytes: number;
    mimeType: string;
  };

  const addFilesFromPaths = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) {
        return;
      }

      setError(null);
      try {
        const inspected = await invoke<LocalFileInfo[]>("inspect_files", { files: paths });
        const normalizePath = (value: string) => value.replace(/\\/g, "/");
        const inspectedPaths = inspected.map((file) => normalizePath(file.path));
        const emptyFolders = paths.filter((rawPath) => {
          const root = normalizePath(rawPath);
          return !inspectedPaths.some(
            (filePath) => filePath === root || filePath.startsWith(`${root}/`),
          );
        });

        if (emptyFolders.length === 1) {
          const name = emptyFolders[0].split(/[/\\]/).filter(Boolean).pop() ?? "Folder";
          toast.info(`Folder is empty: ${name}`);
        } else if (emptyFolders.length > 1) {
          toast.info("Some folders were empty and were skipped.");
        }

        const newFiles = inspected.map((file) => ({
          id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          sizeBytes: file.sizeBytes,
          mimeType: file.mimeType,
          sourcePath: file.path,
        }));

        addFilesToPackage({
          packageId: packageData.id,
          files: newFiles,
          selectedRoots: paths,
        });
      } catch (cause) {
        setError(String(cause));
      }
    },
    [addFilesToPackage, packageData.id],
  );

  useEffect(() => {
    if (packageData.mode !== "send" || !canEditFiles) {
      return;
    }

    let unlisten: (() => void) | null = null;

    const setup = async () => {
      unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type === "over") {
          setIsDragActive(true);
          return;
        }

        if (event.payload.type === "drop") {
          setIsDragActive(false);
          void addFilesFromPaths(event.payload.paths ?? []);
          return;
        }

        setIsDragActive(false);
      });
    };

    void setup();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [addFilesFromPaths, canEditFiles, packageData.mode]);

  const selectAdditionalFiles = useCallback(async () => {
    if (!canEditFiles) {
      return;
    }

    const selected = await open({
      multiple: true,
      directory: false,
      title: "Select files to add",
    });

    if (!selected) {
      return;
    }

    const paths = Array.isArray(selected) ? selected : [selected];
    void addFilesFromPaths(paths);
  }, [addFilesFromPaths, canEditFiles]);
  const menuPosition =
    activeMenuRect && typeof window !== "undefined"
      ? (() => {
        const menuHeight = 44;
        const nextTop = activeMenuRect.bottom + 8;
        const openUp = nextTop + menuHeight > window.innerHeight;
        const top = openUp
          ? Math.max(8, activeMenuRect.top - menuHeight - 8)
          : nextTop;
        const right = Math.max(8, window.innerWidth - activeMenuRect.right);
        return { top, right };
      })()
      : null;
  const progressPercent =
    packageData.mode === "receive"
      ? Math.min(
        100,
        Math.round(
          ((packageData.transferredBytes ?? 0) / Math.max(packageData.totalSizeBytes, 1)) *
          100,
        ),
      )
      : 0;
  const remainingBytes =
    packageData.mode === "receive"
      ? Math.max(
        0,
        packageData.totalSizeBytes - (packageData.transferredBytes ?? 0),
      )
      : 0;
  const etaSeconds = rateBps ? Math.ceil(remainingBytes / rateBps) : null;

  useEffect(() => {
    if (packageData.mode !== "receive" || packageData.status !== "transferring") {
      setRateBps(null);
      setLastProgress(null);
      setLastUiUpdate(0);
      return;
    }

    const now = Date.now();
    const currentBytes = packageData.transferredBytes ?? 0;
    if (!lastProgress) {
      setLastProgress({ bytes: currentBytes, timeMs: now });
      return;
    }

    const deltaBytes = currentBytes - lastProgress.bytes;
    const deltaMs = now - lastProgress.timeMs;
    const minUiIntervalMs = 750;
    const shouldUpdateUi = now - lastUiUpdate >= minUiIntervalMs;

    if (deltaBytes > 0 && deltaMs > 0 && shouldUpdateUi) {
      const instantRate = (deltaBytes / deltaMs) * 1000;
      setRateBps((prev) => (prev ? prev * 0.7 + instantRate * 0.3 : instantRate));
      setLastProgress({ bytes: currentBytes, timeMs: now });
      setLastUiUpdate(now);
    } else if (deltaMs > 3000 && shouldUpdateUi) {
      setLastProgress({ bytes: currentBytes, timeMs: now });
      setLastUiUpdate(now);
    }
  }, [
    lastProgress,
    lastUiUpdate,
    packageData.mode,
    packageData.status,
    packageData.transferredBytes,
  ]);

  useEffect(() => {
    if (packageData.mode !== "receive") {
      return;
    }
    if (autoDownloadTriggered || busy) {
      return;
    }
    if (packageData.status !== "idle" || packageData.sessionId) {
      return;
    }
    if (settings.autoDownloadMaxBytes === 0) {
      return;
    }
    if (
      settings.autoDownloadMaxBytes > 0 &&
      packageData.totalSizeBytes > settings.autoDownloadMaxBytes
    ) {
      return;
    }
    setAutoDownloadTriggered(true);
    void startDownload();
  }, [
    autoDownloadTriggered,
    busy,
    packageData.mode,
    packageData.sessionId,
    packageData.status,
    packageData.totalSizeBytes,
    settings.autoDownloadMaxBytes,
  ]);

  useEffect(() => {
    if (!canEditFiles && activeMenuId) {
      setActiveMenuId(null);
      setActiveMenuRect(null);
      return;
    }

    if (!activeMenuId) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (target.closest("[data-file-actions]") || target.closest("[data-file-menu]")) {
        return;
      }
      setActiveMenuId(null);
      setActiveMenuRect(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveMenuId(null);
        setActiveMenuRect(null);
      }
    };

    const handleScroll = () => {
      setActiveMenuId(null);
      setActiveMenuRect(null);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [activeMenuId, canEditFiles]);

  async function generateTicket() {
    if (!packageData.sourcePaths?.length) {
      setError("No source files found for this package.");
      return;
    }

    setIsGeneratingTicket(true);
    setBusy(true);
    setError(null);

    try {
      const response = await invoke<PackageCreateResponse>("package_create", {
        files: packageData.sourcePaths,
        roots: packageData.selectedRoots ?? [],
      });

      attachTicketToPackage({
        packageId: packageData.id,
        sessionId: response.sessionId,
        backendPackageId: response.packageId,
        ticket: response.ticket,
      });
      await copyTicket(response.ticket);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
      setIsGeneratingTicket(false);
    }
  }

  async function startDownload() {
    if (!packageData.ticket) {
      setError("No ticket found on this package.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await invoke<PackageDownloadResponse>("package_download", {
        ticket: packageData.ticket,
        packageId: packageData.backendPackageId ?? packageData.id,
        downloadDir: settings.downloadDir,
      });

      attachReceiveSession({
        packageId: packageData.id,
        sessionId: result.sessionId,
      });
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function cancelDownload() {
    if (!packageData.sessionId) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await invoke("transfer_cancel", {
        sessionId: packageData.sessionId,
      });
      markCancelledBySession(packageData.sessionId);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function copyTicket(overrideTicket?: string) {
    const ticketToCopy = overrideTicket ?? packageData.ticket;
    if (!ticketToCopy) {
      return;
    }

    try {
      await writeText(ticketToCopy);
      setError(null);
      toast.success("Copied!");
    } catch (pluginError) {
      try {
        await navigator.clipboard.writeText(ticketToCopy);
        setError(null);
        toast.success("Copied!");
      } catch (fallbackError) {
        setError(`Copy failed: ${String(pluginError)} | ${String(fallbackError)}`);
      }
    }
  }

  async function openDownloadFolder() {
    const targetDir = packageData.downloadDir ?? settings.downloadDir;
    if (!targetDir) {
      setError("No download folder available.");
      return;
    }

    try {
      await openPath(targetDir);
    } catch (cause) {
      setError(`Failed to open folder: ${String(cause)}`);
    }
  }

  const maskedTicket = packageData.ticket ? `${packageData.ticket.slice(0, 12)}...` : "";

  return (
    <TooltipProvider delayDuration={100}>
      <section className="space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-slate-500 dark:text-zinc-400" aria-hidden="true" />
              <h2 className="text-2xl font-semibold">Package</h2>
            </div>
            <p className="text-sm text-slate-600 dark:text-zinc-300">
              ID: {packageData.id} | Status: {packageData.status}
            </p>
            {packageData.peerId ? (
              <p className="text-sm text-emerald-700">Peer connected: {packageData.peerId}</p>
            ) : null}
          </div>

          {packageData.mode === "send" ? (
            <div className="flex items-center">
              {!isGeneratingTicket && !packageData.ticket ? (
                <button
                  className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-primary text-primary-foreground hover:opacity-90 h-10 px-4 py-2"
                  type="button"
                  onClick={generateTicket}
                >
                  Get Package Address
                </button>
              ) : null}

              {!isGeneratingTicket && packageData.ticket ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className="flex cursor-pointer items-center gap-3 rounded-md border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-800 p-3 text-xs text-slate-700 dark:text-zinc-200 transition hover:border-slate-300 dark:hover:border-zinc-600"
                      onClick={() => copyTicket()}
                      role="button"
                      aria-label="Copy package ticket"
                    >
                      <span className="min-w-0 flex-1 truncate">{maskedTicket}</span>
                      <Copy className="h-5 w-5 text-slate-500 dark:text-zinc-400" aria-hidden="true" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>Click on the ticket to copy again it.</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          ) : packageData.mode === "receive" ? (
            <div className="flex items-center gap-3">
              {packageData.status === "completed" ? (
                <button
                  className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  type="button"
                  onClick={openDownloadFolder}
                  disabled={busy}
                >
                  <FolderOpen className="h-4 w-4" aria-hidden="true" />
                  Open files folder
                </button>
              ) : (
                <button
                  className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  type="button"
                  onClick={startDownload}
                  disabled={busy || packageData.status === "transferring"}
                >
                  <CloudDownload className="h-4 w-4" aria-hidden="true" />
                  {busy ? "Starting..." : "Download Package"}
                </button>
              )}
            </div>
          ) : null}
        </header>

        {packageData.mode === "send" && canEditFiles ? (
          <div className="">
            <button
              className={cn(
                "group flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-10 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
                isDragActive
                  ? "border-blue-500 bg-blue-50 text-blue-700 shadow-[0_0_0_4px_rgba(59,130,246,0.12)]"
                  : "border-slate-300 dark:border-zinc-600 bg-slate-50 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 hover:border-blue-500 hover:bg-blue-50 hover:text-blue-700 hover:shadow-[0_0_0_4px_rgba(59,130,246,0.12)]",
              )}
              type="button"
              onClick={selectAdditionalFiles}
            >
              <span className="text-lg font-semibold md:text-xl">Drag and drop files here</span>
              <span
                className={cn(
                  "text-sm",
                  isDragActive ? "text-blue-600" : "text-slate-500 dark:text-zinc-400 group-hover:text-blue-600",
                )}
              >
                or click here and select files
              </span>
            </button>
          </div>
        ) : null}

        {packageData.mode === "receive" && packageData.status === "transferring" ? (
          <div className="qs-slide-down rounded-lg py-2">
            <div className="mb-1 flex items-center justify-between">
              <Field className="gap-1">
                <div className="flex items-center gap-1 text-xs text-slate-600 dark:text-zinc-300">
                  <Gauge className="h-5 w-5 text-slate-400 dark:text-zinc-500" aria-hidden="true" />
                  <span>
                    {rateBps ? `${formatBytes(Math.round(rateBps), settings.sizeUnit)}/s` : "—/s"}
                  </span>
                </div>
              </Field>
              <Field className="items-end gap-1 text-right">
                <div className="flex items-center gap-1 text-xs text-slate-600 dark:text-zinc-300">
                  <span>{etaSeconds ? formatDuration(etaSeconds) : "—:—"}</span>
                  <Hourglass className="h-5 w-5 text-slate-400 dark:text-zinc-500" aria-hidden="true" />
                </div>
              </Field>
            </div>
            <div className="flex items-center gap-3">
              <CloudDownload className="h-5 w-5 text-slate-500 dark:text-zinc-400" aria-hidden="true" />
              <Progress value={progressPercent} className="flex-1" />
              <span className="text-xs text-slate-500 dark:text-zinc-400 whitespace-nowrap">
                {formatBytes(packageData.transferredBytes ?? 0, settings.sizeUnit)} /{" "}
                {formatBytes(packageData.totalSizeBytes, settings.sizeUnit)}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 hover:text-slate-900 dark:hover:text-zinc-100"
                    type="button"
                    onClick={cancelDownload}
                    disabled={busy}
                    aria-label="Cancel download"
                  >
                    <OctagonX className="h-4 w-4" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Cancel download</TooltipContent>
              </Tooltip>
            </div>
          </div>
        ) : null}

        <div
          className={cn(
            "rounded-lg border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 transition",
            filesLocked ? "opacity-60" : "opacity-100",
          )}
        >
          {packageData.files.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-zinc-300">No files yet.</p>
          ) : (
            <div className="overflow-x-auto overflow-y-visible">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-zinc-700 text-xs uppercase tracking-wide text-slate-500 dark:text-zinc-400">
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 text-right font-medium">File size</th>
                    <th className="px-3 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-zinc-700">
                  {rows.map((row) => (
                    <tr key={row.id} className="bg-white dark:bg-zinc-900">
                      <td className="px-3 py-2">
                        {row.kind === "folder" ? (
                          <div className="flex items-center gap-2">
                            <Folder className="h-4 w-4 text-slate-500 dark:text-zinc-400" aria-hidden="true" />
                            <span className="truncate text-slate-900 dark:text-zinc-100" title={row.name}>
                              {row.name}
                            </span>
                            <span className="text-xs text-slate-500 dark:text-zinc-400">
                              {row.fileCount} files
                            </span>
                          </div>
                        ) : (
                          <span
                            className="block max-w-[420px] truncate text-slate-900 dark:text-zinc-100"
                            title={row.file.name}
                          >
                            {row.file.name}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600 dark:text-zinc-300">
                        {formatBytes(
                          row.kind === "folder" ? row.sizeBytes : row.file.sizeBytes,
                          settings.sizeUnit,
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {canEditFiles ? (
                          <div className="relative inline-flex" data-file-actions>
                            <button
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 transition hover:bg-slate-50 dark:hover:bg-zinc-800 hover:text-slate-900 dark:hover:text-zinc-100"
                              type="button"
                              aria-label={`Open actions for ${row.kind === "folder" ? row.name : row.file.name
                                }`}
                              aria-haspopup="menu"
                              aria-expanded={activeMenuId === row.id}
                              onClick={(event) => {
                                if (activeMenuId === row.id) {
                                  setActiveMenuId(null);
                                  setActiveMenuRect(null);
                                  return;
                                }
                                const rect = (
                                  event.currentTarget as HTMLButtonElement
                                ).getBoundingClientRect();
                                setActiveMenuRect(rect);
                                setActiveMenuId(row.id);
                              }}
                            >
                              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </div>
                        ) : packageData.mode === "send" ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex h-8 w-8 items-center justify-center text-slate-400 dark:text-zinc-500">
                                <Lock className="h-4 w-4" aria-hidden="true" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>Locked after ticket generation</TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-slate-400 dark:text-zinc-500">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {activeMenuId && menuPosition && activeRow
            ? createPortal(
              <div
                className="fixed z-50 w-40 rounded-md border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-1 shadow-lg"
                style={menuPosition}
                role="menu"
                aria-label="File actions"
                data-file-menu
              >
                <button
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-destructive-foreground hover:bg-destructive"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    if (activeRow.kind === "folder") {
                      removeFilesFromPackage({
                        packageId: packageData.id,
                        fileIds: activeRow.fileIds,
                      });
                    } else {
                      removeFileFromPackage({
                        packageId: packageData.id,
                        fileId: activeRow.file.id,
                      });
                    }
                    setActiveMenuId(null);
                    setActiveMenuRect(null);
                  }}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Remove
                </button>
              </div>,
              document.body,
            )
            : null}
          <p className="mt-3 text-sm text-slate-600 dark:text-zinc-300">
            Total size: {formatBytes(packageData.totalSizeBytes, settings.sizeUnit)}
          </p>
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </section>
    </TooltipProvider>
  );
}
