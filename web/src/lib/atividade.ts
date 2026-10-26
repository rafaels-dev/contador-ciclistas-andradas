import { listarJobs, listarRenders, type Job, type Render } from "./db";
import { estadoInstalacao } from "./motor";
import { sugestoesAtivas } from "./runner";
import { rotuloStatus } from "./status";

/** Etapa em andamento, com processo vivo: mostra barra e mensagem e atualiza a tela. */
export function jobTrabalhando(job: Job): boolean {
  return job.status === "baixando" || job.status === "detectando" || (job.status === "sugerindo" && sugestoesAtivas(job.id));
}

export function renderTrabalhando(r: Render): boolean {
  return r.status === "na_fila" || r.status === "renderizando";
}

export type Tarefa = {
  chave: string;
  href: string;
  nome: string;
  etapa: string;
  /** 0–1, ou null quando não há como medir */
  progresso: number | null;
  mensagem: string | null;
  /** esperando a vez na placa de vídeo (uma detecção/vídeo final por vez) */
  naFila: boolean;
};

/** Tudo o que está rodando agora: downloads, detecções, sugestões, vídeos finais e a instalação do motor. */
export function tarefasEmAndamento(): Tarefa[] {
  const tarefas: Tarefa[] = [];
  const inst = estadoInstalacao();
  if (inst.rodando) {
    tarefas.push({ chave: "motor", href: "/configuracoes", nome: "Motor de detecção", etapa: inst.passo ? `Instalando (passo ${inst.passo} de 3)` : "Atualizando", progresso: null, mensagem: inst.etapa, naFila: false });
  }
  for (const r of listarRenders().filter(renderTrabalhando)) {
    const naFila = r.status === "na_fila";
    tarefas.push({ chave: `r${r.id}`, href: `/renders/${r.id}`, nome: r.nome, etapa: naFila ? "Vídeo final — na fila" : "Gerando vídeo final", progresso: naFila ? null : r.progresso, mensagem: r.mensagem, naFila });
  }
  for (const j of listarJobs().filter(jobTrabalhando)) {
    const naFila = j.status === "detectando" && /fila/i.test(j.mensagem ?? "");
    tarefas.push({ chave: `j${j.id}`, href: `/jobs/${j.id}`, nome: j.nome_arquivo ?? j.drive_id, etapa: naFila ? "Detecção — na fila" : rotuloStatus(j), progresso: naFila ? null : j.progresso, mensagem: j.mensagem, naFila });
  }
  // quem está rodando primeiro, a fila depois
  return tarefas.sort((a, b) => Number(a.naFila) - Number(b.naFila));
}
