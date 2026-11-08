// Minimal bridge between the page (the Next app) and the window: platform,
// window button colors when the theme changes, the native file dialog and the
// app update.
const { contextBridge, ipcRenderer } = require("electron");

const PLATFORM = { win32: "win", darwin: "mac" }[process.platform] ?? "linux";

contextBridge.exposeInMainWorld("trafficCounterDesktop", {
  platform: PLATFORM,
  version: ipcRenderer.sendSync("version"),
  theme: (t) => ipcRenderer.send("theme", t),
  pickVideos: () => ipcRenderer.invoke("pick-videos"),
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  openFolder: (folder) => ipcRenderer.invoke("open-folder", folder),
  saveProjectFile: (defaultPath) => ipcRenderer.invoke("save-project-file", defaultPath),
  openProjectFile: (defaultPath) => ipcRenderer.invoke("open-project-file", defaultPath),
  // update downloaded in the background ("Restart and update" banner)
  update: {
    state: () => ipcRenderer.invoke("update-state"),
    onChange: (cb) => {
      const listener = (_e, state) => cb(state);
      ipcRenderer.on("update", listener);
      return () => ipcRenderer.removeListener("update", listener);
    },
    install: () => ipcRenderer.send("update-install"),
  },
});
