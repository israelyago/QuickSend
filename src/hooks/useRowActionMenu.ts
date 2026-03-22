import { useEffect, useMemo, useState } from "react";
import { type PackageRow } from "./usePackageRows";

type Args = {
  canEditFiles: boolean;
  rows: PackageRow[];
};

export function useRowActionMenu({ canEditFiles, rows }: Args) {
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [activeMenuRect, setActiveMenuRect] = useState<DOMRect | null>(null);

  const activeRow = useMemo(
    () => (activeMenuId ? rows.find((row) => row.id === activeMenuId) ?? null : null),
    [activeMenuId, rows],
  );

  const menuPosition =
    activeMenuRect && typeof window !== "undefined"
      ? (() => {
          const menuHeight = 44;
          const nextTop = activeMenuRect.bottom + 8;
          const openUp = nextTop + menuHeight > window.innerHeight;
          const top = openUp ? Math.max(8, activeMenuRect.top - menuHeight - 8) : nextTop;
          const right = Math.max(8, window.innerWidth - activeMenuRect.right);
          return { top, right };
        })()
      : null;

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

  return {
    activeMenuId,
    activeRow,
    menuPosition,
    setActiveMenuId,
    setActiveMenuRect,
  };
}
