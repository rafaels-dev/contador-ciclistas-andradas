type EstadoAtualizacao = { fase: "nenhuma" | "baixando" | "pronta"; versao: string | null; progresso: number | null };

/** Ponte do app desktop (desktop/preload.cjs); ausente no navegador. */
interface Window {
  contadorDesktop?: {
    plataforma: "win" | "mac" | "linux";
    versao: string;
    /** recolore os botões da janela ao trocar o tema */
    tema?: (t: "dark" | "light") => void;
    /** diálogo nativo de arquivos; devolve os caminhos escolhidos */
    escolherVideos?: () => Promise<string[]>;
    /** atualização do app (electron-updater): baixa sozinha; a faixa oferece reiniciar */
    atualizacao?: {
      estado: () => Promise<EstadoAtualizacao>;
      /** devolve a função que para de ouvir */
      aoMudar: (cb: (e: EstadoAtualizacao) => void) => () => void;
      instalar: () => void;
    };
  };
}
