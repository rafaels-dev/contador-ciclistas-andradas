"use server";

import { refresh } from "next/cache";
import { exigirAcesso } from "@/lib/acesso";
import { gravarVariavel } from "@/lib/env";
import { instalarMotor, pastaMotor } from "@/lib/motor";

/** Só o app desktop grava configuração (no desenvolvimento ela fica no .env do repositório). */
function editavel(): boolean {
  return !!process.env.CONTADOR_ENV;
}

export async function salvarChave(formData: FormData): Promise<void> {
  await exigirAcesso();
  const chave = String(formData.get("chave") ?? "").trim();
  if (!editavel() || !chave || /\s/.test(chave)) return;
  gravarVariavel("OPENROUTER_API_KEY", chave);
  refresh();
}

export async function instalar(): Promise<void> {
  await exigirAcesso();
  if (!pastaMotor()) return;
  instalarMotor();
  refresh();
}
