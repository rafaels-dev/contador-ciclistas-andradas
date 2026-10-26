// Ponte mínima entre a página (o app Next) e a janela: plataforma, cor dos
// botões da janela ao trocar o tema, o diálogo nativo de arquivos e a
// atualização do app.
const { contextBridge, ipcRenderer } = require("electron");

const PLATAFORMA = { win32: "win", darwin: "mac" }[process.platform] ?? "linux";

contextBridge.exposeInMainWorld("contadorDesktop", {
  plataforma: PLATAFORMA,
  versao: ipcRenderer.sendSync("versao"),
  tema: (t) => ipcRenderer.send("tema", t),
  escolherVideos: () => ipcRenderer.invoke("escolher-videos"),
  // atualização baixada em segundo plano (faixa "Reiniciar e atualizar")
  atualizacao: {
    estado: () => ipcRenderer.invoke("atualizacao-estado"),
    aoMudar: (cb) => {
      const ouvinte = (_e, estado) => cb(estado);
      ipcRenderer.on("atualizacao", ouvinte);
      return () => ipcRenderer.removeListener("atualizacao", ouvinte);
    },
    instalar: () => ipcRenderer.send("atualizacao-instalar"),
  },
});
