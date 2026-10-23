// Ponte mínima entre a página (o app Next) e a janela: plataforma, cor dos
// botões da janela ao trocar o tema e o diálogo nativo de arquivos.
const { contextBridge, ipcRenderer } = require("electron");

const PLATAFORMA = { win32: "win", darwin: "mac" }[process.platform] ?? "linux";

contextBridge.exposeInMainWorld("contadorDesktop", {
  plataforma: PLATAFORMA,
  versao: ipcRenderer.sendSync("versao"),
  tema: (t) => ipcRenderer.send("tema", t),
  escolherVideos: () => ipcRenderer.invoke("escolher-videos"),
});
