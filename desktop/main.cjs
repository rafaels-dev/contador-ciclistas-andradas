// Traffic Counter desktop app: a frameless window (title bar drawn by the
// app itself, like Spotify) over the embedded Next server, which runs in a
// child process and listens only on 127.0.0.1.
//
// Folders:
//   resources/web     standalone Next server (scripts/prepare.mjs)
//   resources/engine  Python worker, config.py, YOLO weights, requirements.txt
//   resources/bin     uv, which installs the engine's Python on the first run
//   <userData>/       data (database, processed videos), config.env, engine/ (venv)

const { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session, shell, utilityProcess } = require("electron");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const WIN = process.platform === "win32";
const MAC = process.platform === "darwin";

// title bar colors (the same as the app's --panel/--muted tokens)
const TITLE_BAR = {
  dark: { color: "#222327", symbolColor: "#a0a3a9" },
  light: { color: "#f5f5f2", symbolColor: "#5c5f66" },
};
const BACKGROUND = { dark: "#1a1b1e", light: "#e6e6e2" };

// in development: points to a server already running instead of starting the embedded one
const DEV_URL = process.env.TRAFFIC_COUNTER_DESKTOP_URL;

const WSL = process.platform === "linux" && (() => {
  try {
    return fs.readFileSync("/proc/version", "utf8").toLowerCase().includes("microsoft");
  } catch {
    return false;
  }
})();
// on WSL, a window drawn by the GPU gets "[WARN:COPY MODE]" in the title (WSLg
// does not share those buffers with Windows): draw with the processor
if (WSL) app.disableHardwareAcceleration();

/**
 * Up to 0.0.7 the product was "Contador de Tráfego": the data folder (named
 * after the product), and the names inside it, were Portuguese. Moves it to
 * "Traffic Counter" on the first start; if the move fails (a file in use),
 * keeps using the old folder — nothing is lost. The engine venv keeps its
 * folder: moving a Python environment can break it, and reinstalling is 3 GB.
 *
 * In development, data apart from the installed app's (same product name =
 * same folder): otherwise the installed app's single-instance lock kills the
 * development window with ERR_FAILED.
 */
function useDataFolder() {
  const suffix = app.isPackaged ? "" : " (dev)";
  const appData = app.getPath("appData");
  const target = path.join(appData, `Traffic Counter${suffix}`);
  const old = path.join(appData, `Contador de Tráfego${suffix}`);
  let dir = target;
  if (!fs.existsSync(target) && fs.existsSync(old)) {
    try {
      fs.renameSync(old, target);
    } catch (e) {
      console.error(`[data] could not move ${old}: ${e?.message ?? e}`);
      dir = old;
    }
  }
  app.setPath("userData", dir);
  for (const [from, to] of [["dados", "data"], ["servidor.log", "server.log"], ["janela.json", "window.json"]]) {
    const a = path.join(dir, from);
    const b = path.join(dir, to);
    try {
      if (fs.existsSync(a) && !fs.existsSync(b)) fs.renameSync(a, b);
    } catch (e) {
      console.error(`[data] could not rename ${from}: ${e?.message ?? e}`);
    }
  }
  return dir;
}
const DATA = useDataFolder();
// where the old data stayed, when the rename above failed
const dataPath = (name, legacy) => (fs.existsSync(path.join(DATA, legacy)) && !fs.existsSync(path.join(DATA, name)) ? path.join(DATA, legacy) : path.join(DATA, name));

if (!app.requestSingleInstanceLock()) app.quit();

let mainWindow = null;
let server = null;
// app origin (http://127.0.0.1:<port>): the window only navigates inside it
let appOrigin = null;

// token drawn on every run: the server only serves whoever presents it
// (web/src/lib/access.ts) — and only this window gets it, as a cookie
const TOKEN = crypto.randomBytes(32).toString("hex");

function resources(...parts) {
  return app.isPackaged ? path.join(process.resourcesPath, ...parts) : path.join(__dirname, "resources", ...parts);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function waitForServer(url, limitMs = 60_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      http
        .get(url, (r) => {
          r.resume();
          resolve();
        })
        .on("error", () => {
          if (Date.now() - start > limitMs) reject(new Error("The app server did not answer."));
          else setTimeout(attempt, 250);
        });
    };
    attempt();
  });
}

async function startServer() {
  const port = await freePort();
  const uv = resources("bin", WIN ? "uv.exe" : "uv");
  const logFile = dataPath("server.log", "servidor.log");
  server = utilityProcess.fork(resources("web", "server.js"), [], {
    serviceName: "Traffic Counter server",
    stdio: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      TRAFFIC_COUNTER_DATA: dataPath("data", "dados"),
      TRAFFIC_COUNTER_ENV: path.join(DATA, "config.env"),
      // engines installed up to 0.0.7 stay in motor/ (see useDataFolder)
      TRAFFIC_COUNTER_ENGINE: dataPath("engine", "motor"),
      TRAFFIC_COUNTER_ROOT: resources("engine"),
      TRAFFIC_COUNTER_TOKEN: TOKEN,
      TRAFFIC_COUNTER_VERSION: app.getVersion(),
      TRAFFIC_COUNTER_LOG: logFile, // the diagnostics report includes its end
      // the computer's languages, in order of preference: the app's default language
      TRAFFIC_COUNTER_SYSTEM_LOCALES: [...app.getPreferredSystemLanguages(), app.getLocale()].join(","),
      ...(fs.existsSync(uv) ? { TRAFFIC_COUNTER_UV: uv } : {}),
    },
  });
  const log = fs.createWriteStream(logFile, { flags: "a" });
  server.stdout?.pipe(log);
  server.stderr?.pipe(log);
  server.on("exit", (code) => {
    server = null;
    if (!app.isQuitting) {
      dialog.showErrorBox("Traffic Counter", `The app server stopped (code ${code}). See ${logFile}.`);
      app.quit();
    }
  });
  const url = `http://127.0.0.1:${port}`;
  await waitForServer(url);
  // downloads (final video, CSV): without this Chromium's "Save as" dialog
  // shows the URL in the title; proposes the user's Downloads folder
  session.defaultSession.on("will-download", (_e, item) => {
    item.setSaveDialogOptions({
      defaultPath: path.join(app.getPath("downloads"), item.getFilename()),
    });
  });
  await session.defaultSession.cookies.set({ url, name: "tc_token", value: TOKEN, httpOnly: true, sameSite: "strict" });
  return url;
}

/**
 * On WSL Chromium reads the GTK theme (light, unconfigured), not Windows':
 * follows the Windows registry "app mode". On native systems Electron already
 * follows the computer's theme.
 */
function followWindowsThemeOnWsl() {
  if (!WSL) return;
  try {
    const out = execFileSync("reg.exe", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", "/v", "AppsUseLightTheme"], {
      encoding: "utf8",
      timeout: 3000,
    });
    const m = /AppsUseLightTheme\s+REG_DWORD\s+0x(\d+)/.exec(out);
    if (m) nativeTheme.themeSource = Number(m[1]) ? "light" : "dark";
  } catch {
    // no reg.exe (WSL interop off): Chromium's default stays
  }
}

// window size and position between sessions
const windowFile = () => path.join(DATA, "window.json");
function readWindowState() {
  try {
    return JSON.parse(fs.readFileSync(windowFile(), "utf8"));
  } catch {
    return { width: 1440, height: 900 };
  }
}

function createWindow() {
  const theme = nativeTheme.shouldUseDarkColors ? "dark" : "light";
  const state = readWindowState();
  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: "Traffic Counter",
    backgroundColor: BACKGROUND[theme],
    titleBarStyle: "hidden",
    // Windows/Linux: system buttons over the app's bar; macOS: traffic lights
    ...(MAC ? { trafficLightPosition: { x: 14, y: 12 } } : { titleBarOverlay: { ...TITLE_BAR[theme], height: 40 } }),
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  // window.json from before 0.0.8 says "maximizado"
  if (state.maximized ?? state.maximizado) mainWindow.maximize();
  mainWindow.once("ready-to-show", () => mainWindow.show());

  const save = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const b = mainWindow.getNormalBounds();
    fs.writeFileSync(windowFile(), JSON.stringify({ ...b, maximized: mainWindow.isMaximized() }));
  };
  mainWindow.on("close", save);

  // external links (Drive, OpenRouter) open in the default browser — only
  // http(s); any other scheme (file:, smb:, ms-…) is ignored
  const openOutside = (url) => {
    try {
      if (["http:", "https:"].includes(new URL(url).protocol)) void shell.openExternal(url);
    } catch {}
  };
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (e, url) => {
    let origin = null;
    try {
      origin = new URL(url).origin;
    } catch {}
    if (origin && origin === appOrigin) return;
    e.preventDefault();
    openOutside(url);
  });
  return mainWindow;
}

ipcMain.on("version", (e) => {
  e.returnValue = app.getVersion();
});

// the page's effective theme (the user's choice or the system's): only
// recolors the window — does not pin nativeTheme, or "System" would stop following the computer
ipcMain.on("theme", (e, theme) => {
  if (theme !== "dark" && theme !== "light") return;
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w && !MAC) w.setTitleBarOverlay({ ...TITLE_BAR[theme], height: 40 });
  w?.setBackgroundColor(BACKGROUND[theme]);
});

ipcMain.handle("pick-videos", async (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  // no title or filter name: the system dialog uses its own, in the computer's language
  const r = await dialog.showOpenDialog(w, {
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Video", extensions: ["mp4", "mkv", "avi", "mov", "m4v", "ts", "webm"] }],
  });
  return r.canceled ? [] : r.filePaths;
});

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on("before-quit", () => {
  app.isQuitting = true;
  server?.kill();
});

app.whenReady().then(async () => {
  followWindowsThemeOnWsl();
  // no menu bar on Windows/Linux; on macOS the app menu is mandatory
  Menu.setApplicationMenu(MAC ? Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }]) : null);
  const w = createWindow();
  try {
    const url = DEV_URL ?? (await startServer());
    appOrigin = new URL(url).origin;
    await w.loadURL(url);
  } catch (e) {
    dialog.showErrorBox("Traffic Counter", String(e?.message ?? e));
    app.quit();
    return;
  }
  if (app.isPackaged) startUpdates();
});

// ----------------------------------------------------------------------
// Updates: downloads in the background and installs on close (as before),
// and the window shows a "Version X ready — Restart and update" banner.
// checkForUpdatesAndNotify's native notification did not show on Windows
// and whoever left the app open never knew there was a new version.
// ----------------------------------------------------------------------
/** @type {{ phase: "none" | "downloading" | "ready", version: string | null, progress: number | null }} */
let update = { phase: "none", version: null, progress: null };
let updater = null;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000; // an app left open all day also gets it

function announceUpdate(change) {
  update = { ...update, ...change };
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send("update", update);
}

function startUpdates() {
  const { autoUpdater } = require("electron-updater");
  updater = autoUpdater;
  autoUpdater.autoDownload = true;
  // installing on close is done by installUpdate() (visible), not electron-updater's silent one
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("update-available", (info) => announceUpdate({ phase: "downloading", version: info.version, progress: 0 }));
  autoUpdater.on("download-progress", (p) => announceUpdate({ phase: "downloading", progress: (p.percent ?? 0) / 100 }));
  autoUpdater.on("update-downloaded", (info) => announceUpdate({ phase: "ready", version: info.version, progress: 1 }));
  autoUpdater.on("error", (e) => {
    console.error(`[update] ${e?.message ?? e}`);
    // no internet etc.: the download banner goes away; the next check tries again
    if (update.phase === "downloading") announceUpdate({ phase: "none", progress: null });
  });
  const check = () => {
    if (update.phase !== "ready") autoUpdater.checkForUpdates().catch((e) => console.error(`[update] ${e?.message ?? e}`));
  };
  check();
  setInterval(check, CHECK_EVERY_MS).unref?.();
}

let installing = false;
/**
 * Installs the downloaded version. NOT silent: the silent install removes the
 * old version and takes 1–2 min to put the new one, with nothing on screen —
 * it looked like the app had been uninstalled. This way Windows shows the
 * installer's progress and the app opens again at the end.
 */
function installUpdate() {
  if (!updater || update.phase !== "ready" || installing) return false;
  installing = true;
  app.isQuitting = true; // no "the app server stopped" warning
  server?.kill();
  updater.quitAndInstall(false, true);
  return true;
}

ipcMain.handle("update-state", () => update);
ipcMain.on("update-install", () => installUpdate());
// closing the app with a version already downloaded also installs (as before), but visibly
app.on("before-quit", (e) => {
  if (!installing && update.phase === "ready") {
    e.preventDefault();
    installUpdate();
  }
});

app.on("window-all-closed", () => app.quit());
