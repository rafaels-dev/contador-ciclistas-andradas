"use client";

import { useSyncExternalStore } from "react";
import { BUTTON } from "@/lib/ui";

/** Opens a folder in the system file manager (desktop app only; nothing in the browser). */
export function OpenFolderButton({ folder, label }: { folder: string; label: string }) {
  const desktop = useSyncExternalStore(
    () => () => {},
    () => !!window.trafficCounterDesktop?.openFolder,
    () => false,
  );
  if (!desktop) return null;
  return (
    <button type="button" className={BUTTON.ghost} onClick={() => window.trafficCounterDesktop?.openFolder?.(folder)} data-testid="open-folder">
      {label}
    </button>
  );
}
