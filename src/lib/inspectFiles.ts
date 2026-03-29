import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

export type LocalFileInfo = {
  path: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
};

export async function inspectFilesWithFolderWarnings(paths: string[]): Promise<LocalFileInfo[]> {
  const inspected = await invoke<LocalFileInfo[]>("inspect_files", { files: paths });
  const normalizePath = (value: string) =>
    value
      .replace(/\\/g, "/")
      .replace(/^\/\/(\?|.)\//, "")
      .toLowerCase();

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

  return inspected;
}
