"use server";

import fs from "node:fs";
import path from "node:path";
import { refresh } from "next/cache";
import {
  CATEGORIAS,
  atualizarJob,
  listarCameras,
  obterJob,
  resumoSugestoes,
  revisarCandidatos,
  salvarCamera,
  type Categoria,
  type Linha,
} from "@/lib/db";
import { CLASSES, type Classe } from "@/lib/revisao";
import { dirJob } from "@/lib/paths";
import { cancelarJob, iniciarDeteccao, iniciarDownload, iniciarSugestoes, sugestoesAtivas } from "@/lib/runner";

function validarCategorias(entrada: unknown): Categoria[] | undefined {
  if (!Array.isArray(entrada)) return undefined;
  const cats = CATEGORIAS.filter((c) => entrada.includes(c));
  // todas marcadas = sem restrição
  return cats.length && cats.length < CATEGORIAS.length ? cats : undefined;
}

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
      categorias: validarCategorias(l.categorias),
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

/**
 * Abre a revisão mesmo com candidatos sem sugestão (a IA falhou neles): o
 * humano classifica esses à mão, com a proposta do detector. Sem isto o
 * usuário ficava preso em "Retomar sugestões" quando a falha era persistente.
 */
export async function revisarSemSugestoes(jobId: string): Promise<void> {
  const job = obterJob(jobId);
  if (!job || job.status !== "sugerindo" || sugestoesAtivas(jobId)) return;
  const r = resumoSugestoes(jobId);
  if (r.ok + r.falhou < r.total) return; // ainda há pendentes: retome as sugestões
  atualizarJob(jobId, {
    status: "aguardando_revisao",
    progresso: 1,
    mensagem: `${r.ok} de ${r.total} com sugestão · ${r.falhou} sem sugestão (classifique à mão) · custo US$ ${r.custo.toFixed(4)}`,
  });
  refresh();
}

/** Volta ao editor de linhas depois da detecção (descarta candidatos/sugestões/revisão ao confirmar). */
export async function editarLinhas(jobId: string): Promise<void> {
  const job = obterJob(jobId);
  if (!job || !["sugerindo", "aguardando_revisao", "erro"].includes(job.status) || sugestoesAtivas(jobId)) return;
  if (!fs.existsSync(path.join(dirJob(jobId), "frame0.jpg"))) return;
  atualizarJob(jobId, { status: "aguardando_linhas", erro: null, mensagem: null, progresso: 0 });
  refresh();
}

/**
 * Decisões da revisão humana. Não chama refresh(): a tela mantém o estado
 * local para responder na hora a cada tecla; o servidor só persiste.
 */
export async function revisar(
  jobId: string,
  decisoes: { id: number; rotulo: Classe | null }[],
): Promise<{ erro?: string }> {
  const job = obterJob(jobId);
  if (!job) return { erro: "Job não encontrado." };
  if (job.status !== "aguardando_revisao") return { erro: `O job está em "${job.status}" — a revisão está fechada.` };
  if (!Array.isArray(decisoes) || decisoes.some((d) => !Number.isInteger(d?.id) || (d.rotulo !== null && !CLASSES.includes(d.rotulo)))) {
    return { erro: "Decisão inválida." };
  }
  revisarCandidatos(jobId, decisoes);
  return {};
}

/**
 * Muda só as categorias contadas por linha, sem refazer candidatos nem
 * sugestões (a proposta de descarte é calculada na tela). Atualiza também a
 * câmera salva, para os próximos vídeos dela.
 */
export async function definirCategoriasLinhas(jobId: string, mapa: Record<string, string[]>): Promise<void> {
  const job = obterJob(jobId);
  if (!job || !["sugerindo", "aguardando_revisao"].includes(job.status)) return;
  const aplicar = (linhas: Linha[]) =>
    linhas.map((l) => (l.id in mapa ? { ...l, categorias: validarCategorias(mapa[l.id]) } : l));
  atualizarJob(jobId, { linhas: JSON.stringify(aplicar(JSON.parse(job.linhas) as Linha[])) });
  const cam = job.camera_id ? listarCameras().find((c) => c.id === job.camera_id) : undefined;
  if (cam) salvarCamera(cam.id, cam.nome, aplicar(JSON.parse(cam.linhas) as Linha[]));
  refresh();
}
