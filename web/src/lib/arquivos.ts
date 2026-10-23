import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

const TIPOS: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".mp4": "video/mp4",
  ".json": "application/json",
  ".csv": "text/csv; charset=utf-8",
};

/**
 * Serve um arquivo de dentro de `dir` (com Range, para o <video> pular).
 * `?download=nome` força o download com esse nome de arquivo.
 */
export function servirArquivo(request: Request, dir: string, caminho: string[]): Response {
  let alvo: string;
  let tamanho: number;
  try {
    // realpath: symlinks (ex.: video.mp4 do modo local) não podem escapar do job
    const base = fs.realpathSync(dir);
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
  const baixar = new URL(request.url).searchParams.get("download");
  if (baixar) cabecalhos["Content-Disposition"] = `attachment; filename="${baixar.replace(/[^\w.-]/g, "_")}"`;
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
