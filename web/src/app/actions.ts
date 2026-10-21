"use server";

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { atualizarJob, criarJob } from "@/lib/db";
import { extrairIdDrive, extrairIdPastaDrive, listarVideosDaPasta, type ArquivoDrive } from "@/lib/drive";
import { iniciarDownload } from "@/lib/runner";

export type EstadoNovoJob = { erro?: string; pasta?: { id: string; arquivos: ArquivoDrive[] } };

export async function novoJob(_anterior: EstadoNovoJob, formData: FormData): Promise<EstadoNovoJob> {
  const link = String(formData.get("link") ?? "").trim();

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

  let driveId = extrairIdDrive(link);
  // modo de teste: caminho de um vídeo local em vez de link do Drive
  if (!driveId && process.env.CONTADOR_PERMITIR_LOCAL === "1" && path.isAbsolute(link) && fs.existsSync(link)) {
    driveId = "local";
  }
  if (!driveId) return { erro: "Link do Google Drive inválido." };

  const id = randomUUID().slice(0, 8);
  criarJob({ id, link_drive: link, drive_id: driveId });
  iniciarDownload(id);
  redirect(`/jobs/${id}`);
}

/** Um job por vídeo marcado na pasta; downloads começam em paralelo. */
export async function criarJobsDaPasta(formData: FormData): Promise<void> {
  const escolhidos = formData.getAll("arquivo").map(String);
  const ids: string[] = [];
  for (const item of escolhidos) {
    const [driveId, ...resto] = item.split("|");
    if (!/^[\w-]{20,}$/.test(driveId)) continue;
    const id = randomUUID().slice(0, 8);
    criarJob({ id, link_drive: `https://drive.google.com/file/d/${driveId}/view`, drive_id: driveId });
    atualizarJob(id, { nome_arquivo: resto.join("|").slice(0, 200) || null });
    iniciarDownload(id);
    ids.push(id);
  }
  if (ids.length === 1) redirect(`/jobs/${ids[0]}`);
  refresh();
}
