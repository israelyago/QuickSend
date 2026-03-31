import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

type Args = {
  enabled?: boolean;
  onDropPaths: (paths: string[]) => void;
};

export function useWebviewFileDrop({ enabled = true, onDropPaths }: Args) {
  const [isDragActive, setIsDragActive] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setIsDragActive(false);
      return;
    }

    let unlisten: (() => void) | null = null;
    let didCancel = false;

    const setup = async () => {
      unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type === "over") {
          setIsDragActive(true);
          return;
        }

        if (event.payload.type === "drop") {
          setIsDragActive(false);
          onDropPaths(event.payload.paths ?? []);
          return;
        }

        setIsDragActive(false);
      });

      if (didCancel && unlisten) {
        unlisten();
      }
    };

    void setup();

    return () => {
      didCancel = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [enabled, onDropPaths]);

  return { isDragActive };
}
