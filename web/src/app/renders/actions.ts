"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { atualizarRender, CATEGORIAS, criarRender, obterJob, obterRender, resumoRevisao, type Categoria } from "@/lib/db";
import { cancelarRender, iniciarRender } from "@/lib/runner";

/** Por que um job ainda não pode entrar no vídeo final (null = pode). */
function impedimento(jobId: string): string | null {
  const job = obterJob(jobId);
  if (!job) return "não existe";
  if (job.status !== "aguardando_revisao") return "ainda não chegou à revisão";
  const r = resumoRevisao(jobId);
  if (r.revisados < r.total) return `faltam ${r.total - r.revisados} candidatos na revisão`;
  return null;
}

/**
 * Vídeo final com um ou mais jobs, na ordem dada; o contador soma entre eles.
 * Regra do projeto: só depois da revisão humana completa de cada um.
 */
/** Categorias escolhidas pelo usuário: null = todas; [] é erro. */
function categoriasValidas(escolha: unknown): { categorias: Categoria[] | null } | { erro: string } {
  if (escolha == null) return { categorias: null };
  if (!Array.isArray(escolha)) return { erro: "Categorias inválidas." };
  const cats = CATEGORIAS.filter((c) => escolha.includes(c));
  if (!cats.length) return { erro: "Marque pelo menos uma categoria para o vídeo final." };
  return { categorias: cats.length === CATEGORIAS.length ? null : cats };
}

export async function gerarVideoFinal(jobIds: string[], categoriasEscolhidas: Categoria[] | null = null): Promise<{ erro?: string }> {
  const ids = [...new Set(jobIds.map(String))].filter((id) => /^[\w-]{1,40}$/.test(id));
  if (!ids.length) return { erro: "Escolha pelo menos um vídeo." };
  const cats = categoriasValidas(categoriasEscolhidas);
  if ("erro" in cats) return { erro: cats.erro };
  for (const id of ids) {
    const motivo = impedimento(id);
    if (motivo) return { erro: `${obterJob(id)?.nome_arquivo ?? id}: ${motivo}.` };
  }
  const id = randomUUID().slice(0, 8);
  const nome = ids.map((j) => obterJob(j)?.nome_arquivo ?? j).join(" + ").slice(0, 300);
  criarRender(id, nome, ids, cats.categorias);
  iniciarRender(id);
  refresh(); // contador de exportações na biblioteca lateral
  redirect(`/renders/${id}`);
}

/** Gera de novo com as decisões de revisão atuais (mesmos vídeos, mesma ordem). */
export async function gerarDeNovo(renderId: string, categoriasEscolhidas?: Categoria[] | null): Promise<{ erro?: string }> {
  const render = obterRender(renderId);
  if (!render || render.status === "na_fila" || render.status === "renderizando") return {};
  if (categoriasEscolhidas !== undefined) {
    const cats = categoriasValidas(categoriasEscolhidas);
    if ("erro" in cats) return { erro: cats.erro };
    atualizarRender(renderId, { categorias: cats.categorias ? JSON.stringify(cats.categorias) : null });
  }
  for (const id of JSON.parse(render.jobs) as string[]) {
    const motivo = impedimento(id);
    if (motivo) return { erro: `${obterJob(id)?.nome_arquivo ?? id}: ${motivo}.` };
  }
  iniciarRender(renderId);
  refresh();
  return {};
}

export async function cancelar(renderId: string): Promise<void> {
  const render = obterRender(renderId);
  if (!render || (render.status !== "na_fila" && render.status !== "renderizando")) return;
  cancelarRender(renderId);
  refresh();
}
