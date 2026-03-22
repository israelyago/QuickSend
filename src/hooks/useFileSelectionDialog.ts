import { useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";

type Args = {
  title: string;
};

export function useFileSelectionDialog({ title }: Args) {
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

  return { selectFiles };
}
