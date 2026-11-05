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
    /** app update (electron-updater): downloads by itself; the banner offers to restart */
    update?: {
      state: () => Promise<UpdateState>;
      /** returns the function that stops listening */
      onChange: (cb: (e: UpdateState) => void) => () => void;
      install: () => void;
    };
  };
}
