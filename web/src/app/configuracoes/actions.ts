"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { exigirAcesso } from "@/lib/acesso";
import { gravarConfiguracao } from "@/lib/db";
import { gravarVariavel } from "@/lib/env";
import { detectarPlaca, estadoInstalacao, instalarMotor, pastaMotor, statusMotor, usarPlaca, type Instalacao, type Placa, type StatusMotor } from "@/lib/motor";
import { verificarChave, type VerificacaoChave } from "@/lib/openrouter";

export type EstadoConfiguracao = {
  placa: Placa;
  usarPlaca: boolean;
  /** o app consegue instalar o motor sozinho (app desktop) */
  podeInstalar: boolean;
  temChave: boolean;
};

export async function lerEstado(): Promise<EstadoConfiguracao> {
  await exigirAcesso();
  return { placa: detectarPlaca(), usarPlaca: usarPlaca(), podeInstalar: !!pastaMotor(), temChave: !!process.env.OPENROUTER_API_KEY };
}

/** Demora alguns segundos (o Python carrega o PyTorch para responder). */
export async function verificarMotor(): Promise<StatusMotor> {
  await exigirAcesso();
  return statusMotor();
}

export async function escolherPlaca(usar: boolean): Promise<void> {
  await exigirAcesso();
  gravarConfiguracao("placa", usar ? "gpu" : "cpu");
}

export async function instalar(): Promise<void> {
  await exigirAcesso();
  instalarMotor();
  refresh(); // a barra lateral passa a mostrar a instalação em "Tarefas em andamento"
}

export async function progressoInstalacao(): Promise<Instalacao> {
  await exigirAcesso();
  const e = estadoInstalacao();
  return { ...e, linhas: e.linhas.slice(-60) };
}

/** Testa a chave no OpenRouter e só grava se ela funcionar. */
export async function salvarChave(chave: string): Promise<VerificacaoChave> {
  await exigirAcesso();
  const limpa = String(chave ?? "").trim();
  if (!limpa || /\s/.test(limpa)) return { ok: false, saldo_usd: null, erro: "Cole a chave inteira, sem espaços." };
  // a lista de chaves do OpenRouter mostra só o começo e o fim ("sk-or-v1-7f8…84f"):
  // a chave inteira aparece uma única vez, logo depois de criar
  if (/[.…]{1,3}/.test(limpa) || (limpa.startsWith("sk-or-") && limpa.length < 40)) {
    return {
      ok: false,
      saldo_usd: null,
      erro: "Essa chave está incompleta. O OpenRouter só mostra a chave inteira uma vez, na hora em que ela é criada — crie uma chave nova em Keys e copie na mesma hora.",
    };
  }
  const r = await verificarChave(limpa);
  if (r.ok) gravarVariavel("OPENROUTER_API_KEY", limpa);
  return r;
}

/** Saldo da chave já salva (sem nunca devolver a chave). */
export async function conferirChaveSalva(): Promise<VerificacaoChave> {
  await exigirAcesso();
  const chave = process.env.OPENROUTER_API_KEY;
  return chave ? verificarChave(chave) : { ok: false, saldo_usd: null, erro: "Nenhuma chave salva." };
}

export async function concluirPrimeiroAcesso(): Promise<void> {
  await exigirAcesso();
  gravarConfiguracao("primeiro_acesso", new Date().toISOString());
  redirect("/");
}

export async function refazerPrimeiroAcesso(): Promise<void> {
  await exigirAcesso();
  gravarConfiguracao("primeiro_acesso", null);
  redirect("/boas-vindas");
}
