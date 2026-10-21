import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { obterJob } from "@/lib/db";
import { dirJob } from "@/lib/paths";

const TIPOS: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".mp4": "video/mp4",
  ".json": "application/json",
};

/** Arquivos de um job (frame0, filmstrips, clipes, vídeo final), com Range. */
export async function GET(request: Request, ctx: RouteContext<"/api/jobs/[id]/arquivos/[...caminho]">) {
  const { id, caminho } = await ctx.params;
  // id precisa ser de um job existente (impede id = ".." apontar para data/)
  if (!/^[\w-]{1,40}$/.test(id) || !obterJob(id)) return new Response("Não encontrado", { status: 404 });

  let alvo: string;
  let tamanho: number;
  try {
    // realpath: symlinks (ex.: video.mp4 do modo local) não podem escapar do job
    const base = fs.realpathSync(dirJob(id));
    alvo = fs.realpathSync(path.resolve(base, ...caminho));
    if (!alvo.startsWith(base + path.sep)) return new Response("Caminho inválido", { status: 400 });
    const st = fs.statSync(alvo);
    if (!st.isFile()) throw new Error();
    tamanho = st.size;
  } catch {
    return new Response("Não encontrado", { status: 404 });
  }

  const cabecalhos: Record<string, string> = {
    "Content-Type": TIPOS[path.extname(alvo).toLowerCase()] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=60",
  };
  const range = request.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (range && (range[1] || range[2])) {
    const inicio = range[1] ? Number(range[1]) : Math.max(0, tamanho - Number(range[2]));
    const fim = range[1] && range[2] ? Math.min(Number(range[2]), tamanho - 1) : tamanho - 1;
    if (inicio >= tamanho || inicio > fim) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${tamanho}` } });
    }
    const corpo = Readable.toWeb(fs.createReadStream(alvo, { start: inicio, end: fim })) as ReadableStream;
    return new Response(corpo, {
      status: 206,
      headers: { ...cabecalhos, "Content-Range": `bytes ${inicio}-${fim}/${tamanho}`, "Content-Length": String(fim - inicio + 1) },
    });
  }
  const corpo = Readable.toWeb(fs.createReadStream(alvo)) as ReadableStream;
  return new Response(corpo, { headers: { ...cabecalhos, "Content-Length": String(tamanho) } });
}
