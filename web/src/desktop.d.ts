/** Ponte do app desktop (desktop/preload.cjs); ausente no navegador. */
interface Window {
  contadorDesktop?: {
    plataforma: "win" | "mac" | "linux";
    versao: string;
    /** recolore os botões da janela ao trocar o tema */
    tema?: (t: "dark" | "light") => void;
    /** diálogo nativo de arquivos; devolve os caminhos escolhidos */
    escolherVideos?: () => Promise<string[]>;
  };
}
