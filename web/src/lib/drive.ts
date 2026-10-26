import fs from "node:fs";
import https from "node:https";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { msg } from "@/i18n/message";

/**
 * Extracts the file ID from a Google Drive link. Accepts:
 *   https://drive.google.com/file/d/<ID>/view?usp=sharing
 *   https://drive.google.com/open?id=<ID>
 *   https://drive.google.com/uc?id=<ID>&export=download
 *   https://drive.usercontent.google.com/download?id=<ID>
 *   a bare <ID>
 */
export function driveFileId(link: string): string | null {
  const text = link.trim();
  if (/^[\w-]{20,}$/.test(text)) return text;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (!/(^|\.)google\.com$/.test(url.hostname)) return null;

  const byPath = url.pathname.match(/\/d\/([\w-]{20,})/);
  if (byPath) return byPath[1];

  const byQuery = url.searchParams.get("id");
  if (byQuery && /^[\w-]{20,}$/.test(byQuery)) return byQuery;

  return null;
}

/** ID of a Drive folder (https://drive.google.com/drive/folders/<ID>). */
export function driveFolderId(link: string): string | null {
  try {
    const url = new URL(link.trim());
    if (!/(^|\.)google\.com$/.test(url.hostname)) return null;
    return url.pathname.match(/\/folders\/([\w-]{20,})/)?.[1] ?? null;
  } catch {
    return null;
  }
}

export type DriveFile = { id: string; name: string };

const VIDEO_EXTENSIONS = /\.(mp4|mov|mkv|avi|m4v|webm|dav|ts)$/i;

/** Thrown with a translatable message (lib/i18n/message.ts), shown to the user. */
export class DriveError extends Error {}

/**
 * Lists the videos of a PUBLIC folder without credentials, through Drive's
 * embedded view (the official API would need a key/OAuth).
 */
export async function listFolderVideos(folderId: string): Promise<DriveFile[]> {
  const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new DriveError(msg("drive.folderNotPublic"));
  const html = await res.text();
  const files: DriveFile[] = [];
  for (const m of html.matchAll(/id="entry-([\w-]+)"[\s\S]*?class="flip-entry-title">([^<]*)</g)) {
    const name = m[2].replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
    if (VIDEO_EXTENSIONS.test(name)) files.push({ id: m[1], name });
  }
  return files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

function fileName(res: Response): string | null {
  const cd = res.headers.get("content-disposition") ?? "";
  const utf8 = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) return decodeURIComponent(utf8[1]);
  const simple = cd.match(/filename="?([^";]+)"?/i);
  return simple ? simple[1] : null;
}

/**
 * Large public files go through a "could not scan for viruses" page with a
 * form; resubmits its fields to get the binary.
 */
function warningFormUrl(html: string): string | null {
  const form = html.match(/<form[^>]+id="download-form"[^>]+action="([^"]+)"[\s\S]*?<\/form>/);
  if (!form) return null;
  const url = new URL(form[1].replace(/&amp;/g, "&"));
  for (const m of form[0].matchAll(/<input[^>]+type="hidden"[^>]*>/g)) {
    const name = m[0].match(/name="([^"]+)"/)?.[1];
    const value = m[0].match(/value="([^"]*)"/)?.[1];
    if (name) url.searchParams.set(name, value ?? "");
  }
  return url.toString();
}

/**
 * GET through node:https, returned as a Response. Does not use the global
 * fetch: on the Next server it is intercepted and, even with cache
 * "no-store", holds on to the body — 4 videos of 3.7 GB in parallel took the
 * process to 12 GB of RAM at ~170 KB/s each (outside Next the same download
 * does ~60 MB/s).
 */
function get(url: string, signal: AbortSignal, redirects = 5): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { signal }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new DriveError(msg("drive.tooManyRedirects")));
        return resolve(get(new URL(res.headers.location, url).toString(), signal, redirects - 1));
      }
      const headers = new Headers();
      for (const [k, v] of Object.entries(res.headers)) {
        if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
      }
      resolve(new Response(Readable.toWeb(res) as ReadableStream, { status, headers }));
    });
    req.on("error", reject);
  });
}

/** Downloads a PUBLIC Drive file ("anyone with the link"). */
export async function downloadFromDrive(
  id: string,
  target: string,
  signal: AbortSignal,
  onProgress: (done: number, total: number | null) => void,
): Promise<{ name: string | null; bytes: number }> {
  let res = await get(
    `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`,
    signal,
  );
  if (res.ok && res.headers.get("content-type")?.includes("text/html")) {
    const alternative = warningFormUrl(await res.text());
    if (!alternative) throw new DriveError(msg("drive.notReleased"));
    res = await get(alternative, signal);
  }
  if (!res.ok || !res.body) throw new DriveError(msg("drive.httpError", { status: res.status }));
  if (res.headers.get("content-type")?.includes("text/html")) throw new DriveError(msg("drive.gotPage"));

  const total = Number(res.headers.get("content-length")) || null;
  let done = 0;
  let last = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      done += chunk.length;
      const now = Date.now();
      if (now - last > 1000) {
        last = now;
        onProgress(done, total);
      }
      cb(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), counter, fs.createWriteStream(target));
  onProgress(done, total);
  return { name: fileName(res), bytes: done };
}
