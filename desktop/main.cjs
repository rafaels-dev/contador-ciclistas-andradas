// App desktop do Contador de Tráfego: uma janela sem moldura (barra de título
// desenhada pelo próprio app, como o Spotify) sobre o servidor Next embutido,
// que roda num processo filho e escuta só em 127.0.0.1.
//
// Pastas:
//   recursos/web    servidor Next standalone (scripts/preparar.mjs)
//   recursos/motor  worker Python, config.py, pesos do YOLO, requirements.txt
//   recursos/bin    uv, que instala o Python do motor na 1ª execução
//   <userData>/     dados (banco, vídeos processados), config.env, motor/ (venv)

const { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session, shell, utilityProcess } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const WIN = process.platform === "win32";
const MAC = process.platform === "darwin";

// cores da barra de título (iguais aos tokens --panel/--muted do app)
const BARRA = {
  dark: { color: "#222327", symbolColor: "#a0a3a9" },
  light: { color: "#f5f5f2", symbolColor: "#5c5f66" },
};
const FUNDO = { dark: "#1a1b1e", light: "#e6e6e2" };

// em desenvolvimento: aponta para o `next dev` em vez de subir o servidor embutido
const URL_DEV = process.env.CONTADOR_DESKTOP_URL;

if (!app.requestSingleInstanceLock()) app.quit();

let janela = null;
let servidor = null;
// origem do app (http://127.0.0.1:<porta>): a janela só navega dentro dela
let origemApp = null;

// token sorteado a cada execução: o servidor só atende quem o apresenta
// (web/src/lib/acesso.ts) — e só esta janela o recebe, como cookie
const TOKEN = crypto.randomBytes(32).toString("hex");

function recursos(...partes) {
  return app.isPackaged ? path.join(process.resourcesPath, ...partes) : path.join(__dirname, "recursos", ...partes);
}

function portaLivre() {
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

function esperarServidor(url, limiteMs = 60_000) {
  const inicio = Date.now();
  return new Promise((resolve, reject) => {
    const tentar = () => {
      http
        .get(url, (r) => {
          r.resume();
          resolve();
        })
        .on("error", () => {
          if (Date.now() - inicio > limiteMs) reject(new Error("O servidor do app não respondeu."));
          else setTimeout(tentar, 250);
        });
    };
    tentar();
  });
}

async function subirServidor() {
  const porta = await portaLivre();
  const dados = app.getPath("userData");
  const uv = recursos("bin", WIN ? "uv.exe" : "uv");
  servidor = utilityProcess.fork(recursos("web", "server.js"), [], {
    serviceName: "Servidor do Contador",
    stdio: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(porta),
      HOSTNAME: "127.0.0.1",
      CONTADOR_DADOS: path.join(dados, "dados"),
      CONTADOR_ENV: path.join(dados, "config.env"),
      CONTADOR_MOTOR: path.join(dados, "motor"),
      CONTADOR_RAIZ: recursos("motor"),
      CONTADOR_TOKEN: TOKEN,
      ...(fs.existsSync(uv) ? { CONTADOR_UV: uv } : {}),
    },
  });
  const log = fs.createWriteStream(path.join(dados, "servidor.log"), { flags: "a" });
  servidor.stdout?.pipe(log);
  servidor.stderr?.pipe(log);
  servidor.on("exit", (codigo) => {
    servidor = null;
    if (!app.isQuitting) {
      dialog.showErrorBox("Contador de Tráfego", `O servidor do app parou (código ${codigo}). Veja ${path.join(dados, "servidor.log")}.`);
      app.quit();
    }
  });
  const url = `http://127.0.0.1:${porta}`;
  await esperarServidor(url);
  await session.defaultSession.cookies.set({ url, name: "contador_token", value: TOKEN, httpOnly: true, sameSite: "strict" });
  return url;
}

// tamanho e posição da janela entre sessões
const arquivoJanela = () => path.join(app.getPath("userData"), "janela.json");
function lerEstadoJanela() {
  try {
    return JSON.parse(fs.readFileSync(arquivoJanela(), "utf8"));
  } catch {
    return { width: 1440, height: 900 };
  }
}

function criarJanela() {
  const tema = nativeTheme.shouldUseDarkColors ? "dark" : "light";
  const estado = lerEstadoJanela();
  janela = new BrowserWindow({
    width: estado.width,
    height: estado.height,
    x: estado.x,
    y: estado.y,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: "Contador de Tráfego",
    backgroundColor: FUNDO[tema],
    titleBarStyle: "hidden",
    // Windows/Linux: botões do sistema sobre a barra do app; macOS: semáforo
    ...(MAC ? { trafficLightPosition: { x: 14, y: 12 } } : { titleBarOverlay: { ...BARRA[tema], height: 40 } }),
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  if (estado.maximizado) janela.maximize();
  janela.once("ready-to-show", () => janela.show());

  const salvar = () => {
    if (!janela || janela.isDestroyed()) return;
    const b = janela.getNormalBounds();
    fs.writeFileSync(arquivoJanela(), JSON.stringify({ ...b, maximizado: janela.isMaximized() }));
  };
  janela.on("close", salvar);

  // links externos (Drive, OpenRouter) abrem no navegador padrão — só
  // http(s); qualquer outro esquema (file:, smb:, ms-…) é ignorado
  const abrirFora = (url) => {
    try {
      if (["http:", "https:"].includes(new URL(url).protocol)) void shell.openExternal(url);
    } catch {}
  };
  janela.webContents.setWindowOpenHandler(({ url }) => {
    abrirFora(url);
    return { action: "deny" };
  });
  janela.webContents.on("will-navigate", (e, url) => {
    let origem = null;
    try {
      origem = new URL(url).origin;
    } catch {}
    if (origem && origem === origemApp) return;
    e.preventDefault();
    abrirFora(url);
  });
  return janela;
}

ipcMain.on("versao", (e) => {
  e.returnValue = app.getVersion();
});

ipcMain.on("tema", (e, tema) => {
  if (tema !== "dark" && tema !== "light") return;
  nativeTheme.themeSource = tema;
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w && !MAC) w.setTitleBarOverlay({ ...BARRA[tema], height: 40 });
  w?.setBackgroundColor(FUNDO[tema]);
});

ipcMain.handle("escolher-videos", async (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(w, {
    title: "Escolher vídeos",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Vídeos", extensions: ["mp4", "mkv", "avi", "mov", "m4v", "ts", "webm"] }],
  });
  return r.canceled ? [] : r.filePaths;
});

app.on("second-instance", () => {
  if (!janela) return;
  if (janela.isMinimized()) janela.restore();
  janela.focus();
});

app.on("before-quit", () => {
  app.isQuitting = true;
  servidor?.kill();
});

app.whenReady().then(async () => {
  // sem barra de menus no Windows/Linux; no macOS o menu do app é obrigatório
  Menu.setApplicationMenu(MAC ? Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }]) : null);
  const w = criarJanela();
  try {
    const url = URL_DEV ?? (await subirServidor());
    origemApp = new URL(url).origin;
    await w.loadURL(url);
  } catch (e) {
    dialog.showErrorBox("Contador de Tráfego", String(e?.message ?? e));
    app.quit();
    return;
  }
  if (app.isPackaged) {
    // atualizações como no Spotify: baixa em segundo plano e instala ao fechar
    const { autoUpdater } = require("electron-updater");
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  }
});

app.on("window-all-closed", () => app.quit());
