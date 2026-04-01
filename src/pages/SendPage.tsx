import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../store/appStore";
import { PackageFileDropzone } from "../components/PackageFileDropzone";
import { inspectFilesWithFolderWarnings } from "../lib/inspectFiles";
import { useWebviewFileDrop } from "../hooks/useWebviewFileDrop";
import { useFileSelectionDialog } from "../hooks/useFileSelectionDialog";

export function SendPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const createSendDraftPackage = useAppStore((state) => state.createSendDraftPackage);
  const { selectFiles: selectFilesWithDialog, selectFolders: selectFoldersWithDialog } = useFileSelectionDialog({ title: "Select files to send", foldersTitle: "Select a folder to send" });

  const createPackageFromPaths = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) {
        return;
      }

      try {
        const inspected = await inspectFilesWithFolderWarnings(paths);

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

  const { isDragActive } = useWebviewFileDrop({
    onDropPaths: (paths) => {
      setError(null);
      void createPackageFromPaths(paths);
    },
  });

  async function selectFiles() {
    setError(null);
    const paths = await selectFilesWithDialog();
    if (!paths) {
      return;
    }
    void createPackageFromPaths(paths);
  }

  async function selectFolders() {
    setError(null);
    const paths = await selectFoldersWithDialog();
    if (!paths) {
      return;
    }
    void createPackageFromPaths(paths);
  }

  return (
    <section className="flex flex-col items-center justify-center py-14">
      <div className="w-1/2 rounded-xl bg-card text-card-foreground shadow-sm p-6">
        <PackageFileDropzone isDragActive={isDragActive} onPrimarySelection={selectFiles} onSecondarySelection={selectFolders} />

        {error ? <p className="mt-3 text-sm text-center text-red-600">{error}</p> : null}
      </div>
    </section>
  );
}
