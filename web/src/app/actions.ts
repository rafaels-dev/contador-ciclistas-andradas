"use server";

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { redirect } from "next/navigation";
import { criarJob } from "@/lib/db";
import { extrairIdDrive } from "@/lib/drive";
import { iniciarDownload } from "@/lib/runner";

export type EstadoNovoJob = { erro?: string };

export async function novoJob(_anterior: EstadoNovoJob, formData: FormData): Promise<EstadoNovoJob> {
  const link = String(formData.get("link") ?? "").trim();
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
