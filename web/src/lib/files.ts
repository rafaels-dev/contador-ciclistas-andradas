import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
  ".json": "application/json",
  ".csv": "text/csv; charset=utf-8",
};

/**
 * Serves a file from inside `dir` (with Range, so the <video> can seek).
 * `?download=name` forces a download with that file name.
 */
export function serveFile(request: Request, dir: string, segments: string[]): Response {
  let target: string;
  let size: number;
  try {
    // realpath: symlinks must not escape the job folder
    const base = fs.realpathSync(dir);
    target = fs.realpathSync(path.resolve(base, ...segments));
    if (!target.startsWith(base + path.sep)) return new Response("Invalid path", { status: 400 });
    const st = fs.statSync(target);
    if (!st.isFile()) throw new Error();
    size = st.size;
  } catch {
    return new Response("Not found", { status: 404 });
  }
  return respondWithFile(request, target, size);
}

/** A job's original video, which may live outside the job folder (local video used in place). */
export function serveVideo(request: Request, target: string): Response {
  let size: number;
  try {
    const st = fs.statSync(target);
    if (!st.isFile()) throw new Error();
    size = st.size;
  } catch {
    return new Response("Not found", { status: 404 });
  }
  return respondWithFile(request, target, size);
}

function respondWithFile(request: Request, target: string, size: number): Response {
  const headers: Record<string, string> = {
    "Content-Type": TYPES[path.extname(target).toLowerCase()] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=60",
  };
  const download = new URL(request.url).searchParams.get("download");
  if (download) headers["Content-Disposition"] = `attachment; filename="${download.replace(/[^\w.-]/g, "_")}"`;
  const range = request.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const body = Readable.toWeb(fs.createReadStream(target, { start, end })) as ReadableStream;
    return new Response(body, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  const body = Readable.toWeb(fs.createReadStream(target)) as ReadableStream;
  return new Response(body, { headers: { ...headers, "Content-Length": String(size) } });
}
