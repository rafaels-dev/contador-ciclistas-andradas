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
