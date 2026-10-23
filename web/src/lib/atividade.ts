import type { Job, Render } from "./db";
import { sugestoesAtivas } from "./runner";

/** Etapa em andamento, com processo vivo: mostra barra e mensagem e atualiza a tela. */
export function jobTrabalhando(job: Job): boolean {
  return job.status === "baixando" || job.status === "detectando" || (job.status === "sugerindo" && sugestoesAtivas(job.id));
}

export function renderTrabalhando(r: Render): boolean {
  return r.status === "na_fila" || r.status === "renderizando";
}
