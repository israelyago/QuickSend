import { useMemo } from "react";
import { type FileEntry, type Package } from "../types/domain";

export type FileRow = { kind: "file"; id: string; file: FileEntry };

export type FolderRow = {
  kind: "folder";
  id: string;
  name: string;
  sizeBytes: number;
  fileCount: number;
  fileIds: string[];
};

export type PackageRow = FileRow | FolderRow;

export function usePackageRows(packageData: Package) {
  return useMemo<PackageRow[]>(() => {
    const normalizePath = (value: string) => value.replace(/\\/g, "/");
    const showPerFilePrepare =
      packageData.mode === "send" &&
      packageData.prepareStatus !== undefined &&
      packageData.prepareStatus !== "idle" &&
      !packageData.ticket;

    if (showPerFilePrepare) {
      return packageData.files.map((file) => ({ kind: "file", id: file.id, file }));
    }

    if (packageData.mode === "send" && packageData.selectedRoots?.length) {
      const filesWithPaths = packageData.files
        .map((file) => ({
          file,
          path: file.sourcePath ? normalizePath(file.sourcePath) : null,
        }))
        .filter((item) => item.path);

      const roots = packageData.selectedRoots.map((root) => normalizePath(root)).filter(Boolean);

      const candidateRoots = roots.filter((root) =>
        filesWithPaths.some((item) => item.path?.startsWith(`${root}/`)),
      );

      const dedupedRoots = candidateRoots
        .sort((a, b) => a.length - b.length)
        .filter(
          (root, index, arr) => !arr.slice(0, index).some((parent) => root.startsWith(`${parent}/`)),
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
            const existing = folders.get(root);
            if (existing) {
              existing.sizeBytes += file.sizeBytes;
              existing.fileCount += 1;
              existing.fileIds.push(file.id);
            } else {
              folders.set(root, {
                kind: "folder",
                id: `folder:${root}`,
                name: root,
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

    return packageData.files.map((file) => ({ kind: "file", id: file.id, file }));
  }, [
    packageData.files,
    packageData.mode,
    packageData.prepareStatus,
    packageData.selectedRoots,
    packageData.ticket,
  ]);
}
