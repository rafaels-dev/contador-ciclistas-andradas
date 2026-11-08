type UpdateState = { phase: "none" | "downloading" | "ready"; version: string | null; progress: number | null };

/** Desktop app bridge (desktop/preload.cjs); absent in the browser. */
interface Window {
  trafficCounterDesktop?: {
    platform: "win" | "mac" | "linux";
    version: string;
    /** recolors the window buttons when the theme changes */
    theme?: (t: "dark" | "light") => void;
    /** native file dialog; returns the chosen paths */
    pickVideos?: () => Promise<string[]>;
    /** native folder dialog (Settings → Storage); null when cancelled */
    pickFolder?: () => Promise<string | null>;
    /** opens a folder in the system file manager */
    openFolder?: (folder: string) => Promise<boolean>;
    /** project files: native "Save as" / "Open" dialogs; null when cancelled */
    saveProjectFile?: (defaultPath: string) => Promise<string | null>;
    openProjectFile?: (defaultPath: string) => Promise<string | null>;
    /** app update (electron-updater): downloads by itself; the banner offers to restart */
    update?: {
      state: () => Promise<UpdateState>;
      /** returns the function that stops listening */
      onChange: (cb: (e: UpdateState) => void) => () => void;
      install: () => void;
    };
  };
}
