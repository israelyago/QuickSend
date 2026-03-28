import { Fragment } from "react";
import { createPortal } from "react-dom";
import { Folder, Lock, MoreHorizontal, Trash2 } from "lucide-react";
import { type Package, type Settings } from "../types/domain";
import { cn } from "../lib/utils";
import { type PackageRow } from "../hooks/usePackageRows";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { Progress } from "./ui/progress";

type Props = {
  packageData: Package;
  settings: Settings;
  filesLocked: boolean;
  canEditFiles: boolean;
  rows: PackageRow[];
  activeMenuId: string | null;
  activeRow: PackageRow | null;
  menuPosition: { top: number; right: number } | null;
  formatBytes: (value: number, standard: "jedec" | "iec") => string;
  setActiveMenuId: (id: string | null) => void;
  setActiveMenuRect: (rect: DOMRect | null) => void;
  removeFileFromPackage: (payload: { packageId: string; fileId: string }) => void;
  removeFilesFromPackage: (payload: { packageId: string; fileIds: string[] }) => void;
  removePreparingFile: (
    fileId: string,
    prepareBackendFileId?: string,
    sourcePath?: string,
  ) => void;
};

export function PackageFilesTable({
  packageData,
  settings,
  filesLocked,
  canEditFiles,
  rows,
  activeMenuId,
  activeRow,
  menuPosition,
  formatBytes,
  setActiveMenuId,
  setActiveMenuRect,
  removeFileFromPackage,
  removeFilesFromPackage,
  removePreparingFile,
}: Props) {
  const canRemoveDuringPrepare =
    packageData.mode === "send" &&
    packageData.prepareStatus === "preparing" &&
    !packageData.ticket;

  return (
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
              {rows.map((row) => {
                const showPrepareProgress =
                  row.kind === "file" &&
                  packageData.mode === "send" &&
                  packageData.prepareStatus &&
                  packageData.prepareStatus !== "idle" &&
                  (row.file.prepareStatus === "importing" ||
                    row.file.prepareStatus === "verifying");
                const rowProgress =
                  row.kind === "file" && row.file.sizeBytes > 0
                    ? Math.min(
                      100,
                      ((row.file.prepareProcessedBytes ?? 0) / row.file.sizeBytes) * 100,
                    )
                    : 0;

                return (
                  <Fragment key={row.id}>
                    <tr key={row.id} className="bg-white dark:bg-zinc-900">
                      <td className="px-3 py-2">
                        {row.kind === "folder" ? (
                          <div className="flex items-center gap-2">
                            <Folder className="h-4 w-4 text-slate-500 dark:text-zinc-400" aria-hidden="true" />
                            <span className="truncate text-slate-900 dark:text-zinc-100" title={row.name}>
                              {row.name}
                            </span>
                            <span className="text-xs text-slate-500 dark:text-zinc-400">{row.fileCount} files</span>
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
                        {formatBytes(row.kind === "folder" ? row.sizeBytes : row.file.sizeBytes, settings.sizeUnit)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {canEditFiles || (canRemoveDuringPrepare && row.kind === "file") ? (
                          <div className="relative inline-flex" data-file-actions>
                            <button
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 transition hover:bg-slate-50 dark:hover:bg-zinc-800 hover:text-slate-900 dark:hover:text-zinc-100"
                              type="button"
                              aria-label={`Open actions for ${row.kind === "folder" ? row.name : row.file.name}`}
                              aria-haspopup="menu"
                              aria-expanded={activeMenuId === row.id}
                              onClick={(event) => {
                                if (activeMenuId === row.id) {
                                  setActiveMenuId(null);
                                  setActiveMenuRect(null);
                                  return;
                                }
                                const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
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
                    {showPrepareProgress ? (
                      <tr className="bg-white dark:bg-zinc-900">
                        <td colSpan={3} className="px-3 pb-3 pt-0">
                          <Progress value={rowProgress} className="h-1.5" />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
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
                  if (canRemoveDuringPrepare && activeRow.kind === "file") {
                    removePreparingFile(
                      activeRow.file.id,
                      activeRow.file.prepareBackendFileId,
                      activeRow.file.sourcePath,
                    );
                  } else if (activeRow.kind === "folder") {
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
  );
}
