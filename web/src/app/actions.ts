"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { criarJob } from "@/lib/db";
import { extrairIdDrive } from "@/lib/drive";

export type EstadoNovoJob = { erro?: string };

export async function novoJob(_anterior: EstadoNovoJob, formData: FormData): Promise<EstadoNovoJob> {
  const link = String(formData.get("link") ?? "").trim();
  const driveId = extrairIdDrive(link);
  if (!driveId) return { erro: "Link do Google Drive inválido." };

  const id = randomUUID().slice(0, 8);
  criarJob({ id, link_drive: link, drive_id: driveId });
  // Fase 1: aqui dispara o download (worker) e o job avança sozinho.
  redirect(`/jobs/${id}`);
}
