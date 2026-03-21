import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useAppStore } from "../store/appStore";
import { cn } from "../lib/utils";
import { toast } from "sonner";

type LocalFileInfo = {
  path: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
};

export function SendPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  const createSendDraftPackage = useAppStore((state) => state.createSendDraftPackage);

  const createPackageFromPaths = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) {
        return;
      }

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

        const packageId = createSendDraftPackage({
          sourcePaths: inspected.map((file) => file.path),
          selectedRoots: paths,
          files: inspected.map((file, index) => ({
            id: `file-${index}`,
            name: file.name,
            sizeBytes: file.sizeBytes,
            mimeType: file.mimeType,
            sourcePath: file.path,
          })),
        });

        navigate(`/package/${packageId}`);
      } catch (cause) {
        setError(String(cause));
      }
    },
    [createSendDraftPackage, navigate],
  );

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const setup = async () => {
      unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type === "over") {
          setIsDragActive(true);
          return;
        }

        if (event.payload.type === "drop") {
          setIsDragActive(false);
          setError(null);
          void createPackageFromPaths(event.payload.paths ?? []);
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
  }, [createPackageFromPaths]);

  async function selectFiles() {
    setError(null);

    const selected = await open({
      multiple: true,
      directory: false,
      title: "Select files to send",
    });

    if (!selected) {
      return;
    }

    const paths = Array.isArray(selected) ? selected : [selected];
    void createPackageFromPaths(paths);
  }

  return (
    <section className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold">Send</h2>
        <p className="text-sm text-muted-foreground">
          Pick files, then generate a package ticket from Package View.
        </p>
      </header>

      <div>
        <button
          className={cn(
            "group flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-14 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
            isDragActive
              ? "border-blue-500 dark:border-neutral-700 bg-blue-50 dark:bg-neutral-600 text-blue-700 dark:text-neutral-300 shadow-[0_0_0_4px_rgba(59,130,246,0.12)]"
              : "border-input bg-muted text-foreground hover:border-blue-500 hover:dark:border-neutral-700 hover:bg-blue-50 hover:dark:bg-neutral-600 hover:text-blue-700 hover:dark:text-neutral-300 hover:shadow-[0_0_0_4px_rgba(59,130,246,0.12)]",
          )}
          type="button"
          onClick={selectFiles}
        >
          <span className="text-lg font-semibold md:text-xl">Drag and drop files here</span>
          <span
            className={cn(
              "text-sm",
              isDragActive ? "text-blue-600 dark:text-neutral-300" : "text-muted-foreground group-hover:text-blue-600 dark:group-hover:text-neutral-300",
            )}
          >
            or click here and select files
          </span>
        </button>

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </div>
    </section>
  );
}
