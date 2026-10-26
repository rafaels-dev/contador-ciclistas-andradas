import type { Job } from "./db";

const ROTULO_STATUS: Record<Job["status"], string> = {
  baixando: "Baixando",
  aguardando_linhas: "Defina as linhas de contagem",
  detectando: "Detectando objetos",
  sugerindo: "Sugestão de classificação",
  aguardando_revisao: "Aguardando revisão",
  renderizando: "Gerando vídeo final",
  concluido: "Concluído",
  erro: "Erro",
};

/** Vídeo do computador não é baixado: a etapa 1 só lê o arquivo onde está. */
export function rotuloStatus(job: Pick<Job, "status" | "drive_id">): string {
  if (job.status === "baixando" && job.drive_id === "local") return "Abrindo o vídeo";
  return ROTULO_STATUS[job.status];
}

/** Etapas do fluxo, na ordem — a barra de etapas da tela do vídeo. */
export const ETAPAS = ["Importar", "Linhas", "Detecção", "Sugestões", "Revisão"] as const;

/** Índice da etapa atual em ETAPAS (erro: a etapa em que parou não é conhecida → -1). */
export function etapaAtual(status: Job["status"]): number {
  switch (status) {
    case "baixando": return 0;
    case "aguardando_linhas": return 1;
    case "detectando": return 2;
    case "sugerindo": return 3;
    case "erro": return -1;
    default: return 4;
  }
}
