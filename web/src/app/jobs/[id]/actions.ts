"use server";

import fs from "node:fs";
import path from "node:path";
import { refresh } from "next/cache";
import { atualizarJob, obterJob, resumoSugestoes, salvarCamera, type Linha } from "@/lib/db";
import { dirJob } from "@/lib/paths";
import { cancelarJob, iniciarDeteccao, iniciarDownload, iniciarSugestoes } from "@/lib/runner";

function validarLinhas(entrada: unknown): Linha[] {
  if (!Array.isArray(entrada)) throw new Error("Linhas inválidas.");
  return entrada.map((l, i) => {
    const num = (v: unknown) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error("Coordenada fora do quadro.");
      return n;
    };
    return {
      id: String(l.id ?? `l${i + 1}`).slice(0, 40),
      nome: String(l.nome ?? `Linha ${i + 1}`).slice(0, 80) || `Linha ${i + 1}`,
      x1: num(l.x1),
      y1: num(l.y1),
      x2: num(l.x2),
      y2: num(l.y2),
    };
  });
}

export async function confirmarLinhas(
  jobId: string,
  linhasBrutas: unknown,
  camera: { id: string; nome: string } | null,
): Promise<{ erro?: string }> {
  const job = obterJob(jobId);
  if (!job) return { erro: "Job não encontrado." };
  if (job.status !== "aguardando_linhas") return { erro: `O job está em "${job.status}".` };
  let linhas: Linha[];
  try {
    linhas = validarLinhas(linhasBrutas);
  } catch (e) {
    return { erro: (e as Error).message };
  }
  if (camera?.nome.trim()) {
    const id = camera.id || camera.nome.trim().toLowerCase().replace(/[^\w]+/g, "-");
    salvarCamera(id, camera.nome.trim(), linhas);
    atualizarJob(jobId, { camera_id: id });
  }
  iniciarDeteccao(jobId, linhas);
  refresh();
  return {};
}

export async function tentarNovamente(jobId: string): Promise<void> {
  const job = obterJob(jobId);
  if (!job || job.status !== "erro") return;
  if (resumoSugestoes(jobId).total > 0) {
    // falhou na etapa de sugestões: retoma só os candidatos sem sugestão
    iniciarSugestoes(jobId);
  } else if (fs.existsSync(path.join(dirJob(jobId), "frame0.jpg"))) {
    // vídeo já baixado: volta para a definição das linhas (pré-preenchidas)
    atualizarJob(jobId, { status: "aguardando_linhas", erro: null, mensagem: null, progresso: 0 });
  } else {
    iniciarDownload(jobId);
  }
  refresh();
}

export async function cancelar(jobId: string): Promise<void> {
  const job = obterJob(jobId);
  if (!job || !["baixando", "detectando"].includes(job.status)) return;
  cancelarJob(jobId);
  refresh();
}

export async function retomarSugestoes(jobId: string): Promise<void> {
  const job = obterJob(jobId);
  if (!job || job.status !== "sugerindo") return;
  iniciarSugestoes(jobId);
  refresh();
}
