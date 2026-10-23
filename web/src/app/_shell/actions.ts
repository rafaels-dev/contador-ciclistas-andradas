"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { excluirGrupo, moverJobs, obterGrupo, salvarGrupo } from "@/lib/db";

function nomeValido(nome: unknown): string | null {
  const n = String(nome ?? "").trim().slice(0, 80);
  return n || null;
}

export async function criarGrupo(nome: string): Promise<void> {
  const n = nomeValido(nome);
  if (!n) return;
  const id = randomUUID().slice(0, 8);
  salvarGrupo(id, n);
  redirect(`/?grupo=${id}`);
}

export async function renomearGrupo(id: string, nome: string): Promise<void> {
  const n = nomeValido(nome);
  if (!n || !obterGrupo(id)) return;
  salvarGrupo(id, n);
  refresh();
}

export async function apagarGrupo(id: string): Promise<void> {
  excluirGrupo(String(id));
  redirect("/?grupo=sem");
}

/** grupoId null = tira do grupo. */
export async function moverParaGrupo(ids: string[], grupoId: string | null): Promise<void> {
  if (grupoId && !obterGrupo(grupoId)) return;
  moverJobs(ids.map(String).filter((id) => /^[\w-]{1,40}$/.test(id)), grupoId);
  refresh();
}
