"use server";

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { exigirAcesso } from "@/lib/acesso";
import { atualizarJob, criarJob, obterGrupo } from "@/lib/db";
import { extrairIdDrive, extrairIdPastaDrive, listarVideosDaPasta, type ArquivoDrive } from "@/lib/drive";
import { arquivosLocaisPermitidos, ehVideo, listarPasta, normalizarCaminho, raizes, type ConteudoPasta, type ItemPasta } from "@/lib/locais";
import { iniciarDownload } from "@/lib/runner";

export type EstadoNovoJob = { erro?: string; pasta?: { id: string; arquivos: ArquivoDrive[] } };

/** Grupo de destino da importação (ignora id que não existe). */
function grupoValido(id: unknown): string | null {
  const g = String(id ?? "");
  return g && obterGrupo(g) ? g : null;
}

export async function novoJob(_anterior: EstadoNovoJob, formData: FormData): Promise<EstadoNovoJob> {
  await exigirAcesso();
  const link = String(formData.get("link") ?? "").trim();
  const grupo = grupoValido(formData.get("grupo"));

  const idPasta = extrairIdPastaDrive(link);
  if (idPasta) {
    try {
      const arquivos = await listarVideosDaPasta(idPasta);
      if (!arquivos.length) return { erro: "Nenhum vídeo encontrado nessa pasta." };
      return { pasta: { id: idPasta, arquivos } };
    } catch (e) {
      return { erro: (e as Error).message };
    }
  }

  const driveId = extrairIdDrive(link);
  if (!driveId) {
    // caminho colado de um vídeo do computador também vale
    const local = arquivosLocaisPermitidos() && /^[A-Za-z]:[\\/]|^["/]/.test(link) ? normalizarCaminho(link) : null;
    if (local && fs.existsSync(local) && fs.statSync(local).isFile() && ehVideo(local)) {
      redirect(`/jobs/${criarJobLocal(local, grupo)}`);
    }
    return { erro: local ? "Vídeo não encontrado nesse caminho." : "Link do Google Drive inválido." };
  }

  const id = randomUUID().slice(0, 8);
  criarJob({ id, link_drive: link, drive_id: driveId, grupo_id: grupo });
  iniciarDownload(id);
  redirect(`/jobs/${id}`);
}

/** Job de um vídeo do computador: o arquivo é lido onde está, sem cópia. */
function criarJobLocal(caminho: string, grupo: string | null): string {
  const id = randomUUID().slice(0, 8);
  criarJob({ id, link_drive: caminho, drive_id: "local", grupo_id: grupo });
  atualizarJob(id, { nome_arquivo: path.basename(caminho) });
  iniciarDownload(id);
  return id;
}

export type EstadoPasta = { conteudo?: ConteudoPasta; raizes: ItemPasta[]; erro?: string; selecionado?: string };

/** Navegador de pastas do computador (o app roda localmente). Sem caminho: pasta do usuário. */
export async function navegarPasta(caminho: string | null): Promise<EstadoPasta> {
  await exigirAcesso();
  if (!arquivosLocaisPermitidos()) return { raizes: [], erro: "Vídeos do computador estão desligados neste servidor." };
  const base = { raizes: raizes() };
  try {
    let alvo = caminho ? normalizarCaminho(caminho) : base.raizes[0].caminho;
    let selecionado: string | undefined;
    if (fs.statSync(alvo).isFile()) {
      // colou o caminho de um vídeo: abre a pasta dele com o vídeo marcado
      selecionado = alvo;
      alvo = path.dirname(alvo);
    }
    return { ...base, conteudo: listarPasta(alvo), selecionado };
  } catch {
    return { ...base, erro: "Pasta não encontrada ou sem permissão de leitura." };
  }
}

export async function criarJobsLocais(caminhos: string[], grupoId: string | null = null): Promise<void> {
  await exigirAcesso();
  if (!arquivosLocaisPermitidos()) return;
  const grupo = grupoValido(grupoId);
  const ids = caminhos
    .map(normalizarCaminho)
    .filter((c) => ehVideo(c) && fs.existsSync(c) && fs.statSync(c).isFile())
    .map((c) => criarJobLocal(c, grupo));
  refresh(); // a biblioteca lateral (layout) não é refeita só pelo redirect
  if (ids.length === 1) redirect(`/jobs/${ids[0]}`);
  redirect(grupo ? `/?grupo=${grupo}` : "/");
}

/** Um job por vídeo marcado na pasta; downloads começam em paralelo. */
export async function criarJobsDaPasta(formData: FormData): Promise<void> {
  const escolhidos = formData.getAll("arquivo").map(String);
  const grupo = grupoValido(formData.get("grupo"));
  const ids: string[] = [];
  for (const item of escolhidos) {
    const [driveId, ...resto] = item.split("|");
    if (!/^[\w-]{20,}$/.test(driveId)) continue;
    const id = randomUUID().slice(0, 8);
    criarJob({ id, link_drive: `https://drive.google.com/file/d/${driveId}/view`, drive_id: driveId, grupo_id: grupo });
    atualizarJob(id, { nome_arquivo: resto.join("|").slice(0, 200) || null });
    iniciarDownload(id);
    ids.push(id);
  }
  refresh(); // a biblioteca lateral (layout) não é refeita só pelo redirect
  if (ids.length === 1) redirect(`/jobs/${ids[0]}`);
  redirect(grupo ? `/?grupo=${grupo}` : "/");
}
