import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { appLocale } from "@/i18n/server";
import { ENV_FILE } from "./env";
import { candidateSummary, listFailedCandidates, listJobs, listRenders, suggestionSummary } from "./db";
import { detectGpu, engineDir, enginePython, engineStatus, installState, gpuPreferred } from "./engine";
import { suggestionModels } from "./openrouter";
import { DATA_DIR, REPO_ROOT, jobDir } from "./paths";

/**
 * Diagnostics report: a .zip the user saves and sends to whoever supports
 * the app when something goes wrong. Gathers the server log, the
 * configuration (without the AI key), the engine state, the jobs and renders
 * with their errors and, for each failed suggestion, what OpenRouter answered
 * and the images sent. No video and no key.
 */

/** Server log: Electron writes it to TRAFFIC_COUNTER_LOG (userData/server.log). */
export const LOG_FILE = process.env.TRAFFIC_COUNTER_LOG ?? path.join(DATA_DIR, "..", "server.log");

const LOG_MAX = 3 * 1024 * 1024; // only the end of the log, if it is large
const IMAGES_MAX = 60; // filmstrips/contexts of the failures

type Entry = { name: string; data: Buffer };

/** Uncompressed ZIP (the JPGs are already compressed; the log is small) — avoids a dependency just for this. */
function zip(entries: Entry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  for (const { name, data } of entries) {
    const n = Buffer.from(name, "utf8");
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // no compression
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    local.writeUInt16LE(0, 28);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(dosTime, 12);
    cd.writeUInt16LE(dosDate, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(n.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    parts.push(local, n, data);
    central.push(cd, n);
    offset += local.length + n.length + data.length;
  }
  const centralSize = central.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, ...central, end]);
}

function readTail(file: string, max: number): string | null {
  try {
    const st = fs.statSync(file);
    const fd = fs.openSync(file, "r");
    try {
      const size = Math.min(st.size, max);
      const buf = Buffer.alloc(size);
      fs.readSync(fd, buf, 0, size, st.size - size);
      return (st.size > max ? `[… ${st.size - max} earlier bytes omitted …]\n` : "") + buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

/** config.env without the value of keys/secrets. */
function maskedConfig(): string | null {
  try {
    return fs
      .readFileSync(ENV_FILE, "utf8")
      .split(/\r?\n/)
      .map((l) => (/^\s*(export\s+)?[A-Z0-9_]*(KEY|TOKEN|SECRET|SENHA|PASSWORD)[A-Z0-9_]*\s*=/i.test(l) ? l.replace(/=.*$/, "=<omitted>") : l))
      .join("\n");
  } catch {
    return null;
  }
}

function exists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

export async function buildDiagnostics(): Promise<{ name: string; zip: Buffer }> {
  const entries: Entry[] = [];
  const text = (name: string, content: string) => entries.push({ name, data: Buffer.from(content, "utf8") });
  const json = (name: string, value: unknown) => text(name, JSON.stringify(value, null, 1));

  const engine = await engineStatus().catch((e) => ({ python: enginePython(), ok: false, error: String(e) }));
  const gpu = detectGpu();
  const summary = {
    generated_at: new Date().toISOString(),
    app: { version: process.env.TRAFFIC_COUNTER_VERSION ?? "(dev)", desktop: !!process.env.TRAFFIC_COUNTER_TOKEN, node: process.version, language: appLocale() },
    system: { platform: process.platform, version: os.release(), arch: process.arch, cpus: os.cpus().length, memory_gb: Math.round(os.totalmem() / 2 ** 30), locale: Intl.DateTimeFormat().resolvedOptions().locale, system_locales: process.env.TRAFFIC_COUNTER_SYSTEM_LOCALES ?? null },
    gpu: { detected: gpu, use: gpuPreferred() },
    engine: { ...engine, folder: engineDir(), install: installState() },
    ai: { key_configured: !!process.env.OPENROUTER_API_KEY, models: suggestionModels() },
    folders: { data: DATA_DIR, root: REPO_ROOT, config: ENV_FILE, log: LOG_FILE, bicycle_weights: exists(path.join(REPO_ROOT, "runs", "ft_blur", "weights", "best.pt")) },
  };
  json("summary.json", summary);

  const log = readTail(LOG_FILE, LOG_MAX);
  if (log != null) text("server.log", log);
  const config = maskedConfig();
  if (config != null) text("config.env", config);

  const jobs = listJobs();
  json(
    "jobs.json",
    jobs.map((j) => {
      const d = jobDir(j.id);
      return {
        ...j,
        lines: JSON.parse(j.lines),
        suggestions: suggestionSummary(j.id),
        candidates: candidateSummary(j.id),
        files: exists(d) ? fs.readdirSync(d).filter((a) => !a.startsWith(".")) : [],
      };
    }),
  );
  json("renders.json", listRenders());

  for (const j of jobs) {
    const errors = path.join(jobDir(j.id), "suggestion_errors.jsonl");
    const content = readTail(errors, 1024 * 1024);
    if (content != null) text(`jobs/${j.id}/suggestion_errors.jsonl`, content);
  }

  const failures = listFailedCandidates();
  json("failed_suggestions.json", failures);
  let images = 0;
  for (const c of failures) {
    if (images >= IMAGES_MAX) break;
    for (const rel of [c.filmstrip, c.context]) {
      if (!rel) continue;
      try {
        entries.push({ name: `jobs/${c.job_id}/${rel.replaceAll("\\", "/")}`, data: fs.readFileSync(path.join(jobDir(c.job_id), rel)) });
        images++;
      } catch {}
    }
  }

  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  return { name: `traffic-counter-diagnostics-${stamp}.zip`, zip: zip(entries) };
}
