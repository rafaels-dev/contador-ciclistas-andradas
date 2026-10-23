import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Vídeos do próprio computador, usados onde estão (sem cópia). O app roda na
 * máquina do usuário, então o servidor navega pelas pastas no lugar do
 * seletor de arquivos do navegador (que não revela o caminho do arquivo).
 */

export const EXTENSOES_VIDEO = [".mp4", ".mkv", ".avi", ".mov", ".m4v", ".ts", ".webm"];

export type ItemPasta = { nome: string; caminho: string; bytes?: number };
export type ConteudoPasta = { caminho: string; pai: string | null; pastas: ItemPasta[]; videos: ItemPasta[] };

/**
 * Aceita o que o usuário colar: tira aspas ("Copiar como caminho" do Windows
 * as inclui) e, com o servidor no Linux/WSL, traduz C:\pasta → /mnt/c/pasta.
 */
export function normalizarCaminho(bruto: string): string {
  let p = bruto.trim().replace(/^"(.*)"$/, "$1");
  const win = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  if (win && process.platform !== "win32") {
    p = path.posix.join("/mnt", win[1].toLowerCase(), win[2].replace(/\\/g, "/"));
  }
  return path.resolve(p);
}

export function ehVideo(nome: string): boolean {
  return EXTENSOES_VIDEO.includes(path.extname(nome).toLowerCase());
}

/** Atalhos para começar a navegar: pasta do usuário e discos. */
export function raizes(): ItemPasta[] {
  const lista: ItemPasta[] = [{ nome: "Pasta do usuário", caminho: os.homedir() }];
  if (process.platform === "win32") {
    for (const letra of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
      if (fs.existsSync(`${letra}:\\`)) lista.push({ nome: `${letra}:`, caminho: `${letra}:\\` });
    }
  } else {
    // WSL: discos do Windows montados em /mnt/<letra>
    for (const d of fs.existsSync("/mnt") ? fs.readdirSync("/mnt") : []) {
      if (/^[a-z]$/.test(d)) lista.push({ nome: `${d.toUpperCase()}: (Windows)`, caminho: `/mnt/${d}` });
    }
  }
  return lista;
}

export function listarPasta(caminho: string): ConteudoPasta {
  const entradas = fs.readdirSync(caminho, { withFileTypes: true });
  const pastas: ItemPasta[] = [];
  const videos: ItemPasta[] = [];
  for (const e of entradas) {
    if (e.name.startsWith(".") || e.name.startsWith("$")) continue; // ocultos e de sistema
    const completo = path.join(caminho, e.name);
    try {
      const st = fs.statSync(completo); // segue atalhos/symlinks
      if (st.isDirectory()) pastas.push({ nome: e.name, caminho: completo });
      else if (st.isFile() && ehVideo(e.name)) videos.push({ nome: e.name, caminho: completo, bytes: st.size });
    } catch {
      // sem permissão ou link quebrado: não aparece
    }
  }
  const ordem = (a: ItemPasta, b: ItemPasta) => a.nome.localeCompare(b.nome, "pt-BR", { numeric: true });
  const pai = path.dirname(caminho);
  return { caminho, pai: pai === caminho ? null : pai, pastas: pastas.sort(ordem), videos: videos.sort(ordem) };
}
