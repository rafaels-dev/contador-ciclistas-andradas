import fs from "node:fs";
import https from "node:https";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * Extrai o ID de arquivo de um link do Google Drive. Aceita os formatos:
 *   https://drive.google.com/file/d/<ID>/view?usp=sharing
 *   https://drive.google.com/open?id=<ID>
 *   https://drive.google.com/uc?id=<ID>&export=download
 *   https://drive.usercontent.google.com/download?id=<ID>
 *   <ID> puro
 */
export function extrairIdDrive(link: string): string | null {
  const texto = link.trim();
  if (/^[\w-]{20,}$/.test(texto)) return texto;

  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return null;
  }
  if (!/(^|\.)google\.com$/.test(url.hostname)) return null;

  const porCaminho = url.pathname.match(/\/d\/([\w-]{20,})/);
  if (porCaminho) return porCaminho[1];

  const porQuery = url.searchParams.get("id");
  if (porQuery && /^[\w-]{20,}$/.test(porQuery)) return porQuery;

  return null;
}

/** ID de uma pasta do Drive (https://drive.google.com/drive/folders/<ID>). */
export function extrairIdPastaDrive(link: string): string | null {
  try {
    const url = new URL(link.trim());
    if (!/(^|\.)google\.com$/.test(url.hostname)) return null;
    return url.pathname.match(/\/folders\/([\w-]{20,})/)?.[1] ?? null;
  } catch {
    return null;
  }
}

export type ArquivoDrive = { id: string; nome: string };

const EXTENSOES_VIDEO = /\.(mp4|mov|mkv|avi|m4v|webm|dav|ts)$/i;

/**
 * Lista os vídeos de uma pasta PÚBLICA sem credenciais, pela visualização
 * embutida do Drive (a API oficial exigiria chave/OAuth).
 */
export async function listarVideosDaPasta(idPasta: string): Promise<ArquivoDrive[]> {
  const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(idPasta)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Não foi possível abrir a pasta — ela é pública (qualquer pessoa com o link)?");
  const html = await res.text();
  const arquivos: ArquivoDrive[] = [];
  for (const m of html.matchAll(/id="entry-([\w-]+)"[\s\S]*?class="flip-entry-title">([^<]*)</g)) {
    const nome = m[2].replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
    if (EXTENSOES_VIDEO.test(nome)) arquivos.push({ id: m[1], nome });
  }
  return arquivos.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { numeric: true }));
}

function nomeDoArquivo(res: Response): string | null {
  const cd = res.headers.get("content-disposition") ?? "";
  const utf8 = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) return decodeURIComponent(utf8[1]);
  const simples = cd.match(/filename="?([^";]+)"?/i);
  return simples ? simples[1] : null;
}

/**
 * Arquivos grandes públicos passam por uma página "não foi possível verificar
 * vírus" com um formulário; reenvia os campos dele para obter o binário.
 */
function urlDoFormularioDeAviso(html: string): string | null {
  const form = html.match(/<form[^>]+id="download-form"[^>]+action="([^"]+)"[\s\S]*?<\/form>/);
  if (!form) return null;
  const url = new URL(form[1].replace(/&amp;/g, "&"));
  for (const m of form[0].matchAll(/<input[^>]+type="hidden"[^>]*>/g)) {
    const nome = m[0].match(/name="([^"]+)"/)?.[1];
    const valor = m[0].match(/value="([^"]*)"/)?.[1];
    if (nome) url.searchParams.set(nome, valor ?? "");
  }
  return url.toString();
}

/**
 * GET via node:https, devolvido como Response. Não usa o fetch global: no
 * servidor do Next ele é interceptado e, mesmo com cache "no-store", retém o
 * corpo — 4 vídeos de 3,7 GB em paralelo levaram o processo a 12 GB de RAM e
 * a ~170 KB/s cada (fora do Next o mesmo download faz ~60 MB/s).
 */
function obter(url: string, sinal: AbortSignal, redirecionamentos = 5): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { signal: sinal }, (msg) => {
      const status = msg.statusCode ?? 0;
      if (status >= 300 && status < 400 && msg.headers.location) {
        msg.resume();
        if (redirecionamentos <= 0) return reject(new Error("Redirecionamentos demais no download do Drive."));
        return resolve(obter(new URL(msg.headers.location, url).toString(), sinal, redirecionamentos - 1));
      }
      const headers = new Headers();
      for (const [k, v] of Object.entries(msg.headers)) {
        if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
      }
      resolve(new Response(Readable.toWeb(msg) as ReadableStream, { status, headers }));
    });
    req.on("error", reject);
  });
}

/** Baixa um arquivo PÚBLICO do Drive ("qualquer pessoa com o link"). */
export async function baixarDoDrive(
  id: string,
  destino: string,
  sinal: AbortSignal,
  aoProgredir: (baixados: number, total: number | null) => void,
): Promise<{ nome: string | null; bytes: number }> {
  let res = await obter(
    `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`,
    sinal,
  );
  if (res.ok && res.headers.get("content-type")?.includes("text/html")) {
    const alternativa = urlDoFormularioDeAviso(await res.text());
    if (!alternativa) {
      throw new Error("O Drive não liberou o download — confira se o link é público (qualquer pessoa com o link).");
    }
    res = await obter(alternativa, sinal);
  }
  if (!res.ok || !res.body) throw new Error(`Falha no download do Drive (HTTP ${res.status}).`);
  if (res.headers.get("content-type")?.includes("text/html")) {
    throw new Error("O Drive devolveu uma página em vez do vídeo — o arquivo é público?");
  }

  const total = Number(res.headers.get("content-length")) || null;
  let baixados = 0;
  let ultimo = 0;
  const contador = new Transform({
    transform(pedaco: Buffer, _enc, cb) {
      baixados += pedaco.length;
      const agora = Date.now();
      if (agora - ultimo > 1000) {
        ultimo = agora;
        aoProgredir(baixados, total);
      }
      cb(null, pedaco);
    },
  });
  await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), contador, fs.createWriteStream(destino));
  aoProgredir(baixados, total);
  return { nome: nomeDoArquivo(res), bytes: baixados };
}
