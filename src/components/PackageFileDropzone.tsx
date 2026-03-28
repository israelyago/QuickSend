import { FilePlus } from "lucide-react";
import { cn } from "../lib/utils";

type Props = {
  isDragActive: boolean;
  onSelectAdditionalFiles: () => void;
  onSelectFolder: () => void;
};

export function PackageFileDropzone({ isDragActive, onSelectAdditionalFiles, onSelectFolder }: Props) {
  return (
    <div className="">
      <button
        className={cn(
          "group flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-10 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
          isDragActive
            ? "border-blue-500 bg-blue-50 text-blue-700 shadow-[0_0_0_4px_rgba(59,130,246,0.12)] dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-200"
            : "border-slate-300 dark:border-zinc-600 bg-slate-50 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-zinc-700 hover:text-blue-700 hover:shadow-[0_0_0_4px_rgba(59,130,246,0.12)]",
        )}
        role="button"
        tabIndex={0}
        onClick={onSelectAdditionalFiles}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectAdditionalFiles();
          }
        }}
      >
        <FilePlus className="mt-4 h-12 w-12 opacity-80 transition-opacity group-hover:opacity-100" />
        <span className="mt-8 text-lg font-semibold md:text-xl">Add files</span>
        <span
          className={cn(
            "text-sm underline cursor-pointer",
            isDragActive ? "text-blue-600 dark:text-zinc-400" : "text-slate-500 dark:text-zinc-400 group-hover:text-blue-600",
          )}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSelectFolder();
          }}
        >
          Or select a folder
        </span>
      </button>
    </div>
  );
}
