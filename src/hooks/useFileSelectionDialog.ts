import { useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";

type Args = {
  title: string;
  foldersTitle: string;
};

export function useFileSelectionDialog({ title, foldersTitle }: Args) {
  const selectFiles = useCallback(async () => {
    const selected = await open({
      multiple: true,
      directory: false,
      title,
    });

    if (!selected) {
      return null;
    }

    return Array.isArray(selected) ? selected : [selected];
  }, [title]);

  const selectFolders = useCallback(async () => {
    const selected = await open({
      multiple: false,
      directory: true,
      title: foldersTitle ?? title,
    });

    if (!selected) {
      return null;
    }

    return Array.isArray(selected) ? selected : [selected];
  }, [title, foldersTitle]);

  return { selectFiles, selectFolders };
}
