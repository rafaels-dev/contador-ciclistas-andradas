import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import zlib from "node:zlib";
import { SCHEMA } from "./schema";

/**
 * Up to version 0.0.7 the app (code, database and files) was in Portuguese.
 * On the first start of a newer version this moves everything to the English
 * names: tables, columns and stored values in the database, and the files in
 * each processed video's folder — nothing has to be detected again. Files
 * first (each step skips what was already moved), then the database in one
 * transaction: if it is interrupted, the next start finishes the job.
 */

const CATEGORY: Record<string, string> = {
  ciclistas: "cyclists",
  patinetes: "kick_scooters",
  scooters: "mopeds",
  monociclos: "unicycles",
  pedestres: "pedestrians",
  automoveis: "cars",
  motocicletas: "motorcycles",
  outros: "other",
  descartado: "discarded",
};
const GROUP: Record<string, string> = { pes: "ped", bic: "bike", aut: "car", mot: "moto", mov: "motion" };
const JOB_STATUS: Record<string, string> = {
  baixando: "downloading",
  aguardando_linhas: "awaiting_lines",
  detectando: "detecting",
  sugerindo: "suggesting",
  aguardando_revisao: "awaiting_review",
  renderizando: "rendering",
  concluido: "done",
  erro: "error",
};
const RENDER_STATUS: Record<string, string> = { na_fila: "queued", renderizando: "rendering", pronto: "ready", erro: "error" };
const LLM_STATUS: Record<string, string> = { pendente: "pending", ok: "ok", falhou: "failed" };
const ORIGIN: Record<string, string> = {
  track: "track",
  movimento: "motion",
  pessoa_com_bicicleta: "person_on_bicycle",
  pessoa_com_moto: "person_on_motorcycle",
};
const SETTING: Record<string, string> = { placa: "gpu", primeiro_acesso: "first_run" };

const cat = (v: unknown) => (typeof v === "string" ? (CATEGORY[v] ?? v) : v ?? null);
const trackKey = (k: string) => k.replace(/^(\w+):/, (m, g: string) => `${GROUP[g] ?? g}:`);
const mediaPath = (p: unknown) =>
  typeof p === "string"
    ? p.replace(/^candidatos\//, "candidates/").replace(/^candidates\/contextos\//, "candidates/contexts/").replace(/^candidates\/clipes\//, "candidates/clips/")
    : null;

type OldLine = { id: string; nome?: string; name?: string; categorias?: string[]; categories?: string[]; [k: string]: unknown };

function lines(json: string | null | undefined): string {
  let list: OldLine[] = [];
  try {
    list = JSON.parse(json || "[]");
  } catch {}
  return JSON.stringify(
    list.map(({ nome, name, categorias, categories, ...rest }) => ({
      ...rest,
      name: name ?? nome ?? "",
      ...((categories ?? categorias) ? { categories: (categories ?? categorias)!.map((c) => cat(c) as string) } : {}),
    })),
  );
}

function categoryList(json: string | null): string | null {
  if (!json) return null;
  try {
    return JSON.stringify((JSON.parse(json) as string[]).map(cat));
  } catch {
    return null;
  }
}

function tableExists(d: DatabaseSync, name: string): boolean {
  return !!d.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function rows(d: DatabaseSync, table: string): Record<string, unknown>[] {
  return tableExists(d, table) ? (d.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]).map((r) => ({ ...r })) : [];
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

function move(from: string, to: string): void {
  if (fs.existsSync(from) && !fs.existsSync(to)) fs.renameSync(from, to);
}

function rewriteJson(from: string, to: string, map: (data: never) => unknown): void {
  if (!fs.existsSync(from)) return;
  if (!fs.existsSync(to)) fs.writeFileSync(to, JSON.stringify(map(JSON.parse(fs.readFileSync(from, "utf8")) as never)));
  fs.rmSync(from, { force: true });
}

type OldMeta = Record<string, unknown>;
function trackMeta(m: OldMeta): OldMeta {
  const { largura, altura, fator, escala, versao, mov_fino, ...rest } = m;
  return { ...rest, width: largura, height: altura, factor: fator, scale: escala, version: versao, motion_fine: mov_fino };
}

type OldTrack = { grupo: string; tid: number; frames: number[]; caixas: number[][]; classes: object; conf_soma: number; n_bike: number; n_moto: number; vizinhos: Record<string, number>; emendas: string[] };
function tracksFile(from: string, to: string): void {
  if (!fs.existsSync(from)) return;
  if (!fs.existsSync(to)) {
    const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(from)).toString("utf8")) as { meta: OldMeta; tracks: OldTrack[] };
    const tracks = data.tracks.map((t) => ({
      group: GROUP[t.grupo] ?? t.grupo,
      tid: t.tid,
      frames: t.frames,
      boxes: t.caixas,
      classes: t.classes,
      conf_sum: t.conf_soma,
      n_bike: t.n_bike,
      n_moto: t.n_moto,
      neighbors: Object.fromEntries(Object.entries(t.vizinhos ?? {}).map(([k, v]) => [trackKey(k), v])),
      splices: (t.emendas ?? []).map(trackKey),
    }));
    fs.writeFileSync(to, zlib.gzipSync(JSON.stringify({ meta: trackMeta(data.meta), tracks })));
  }
  fs.rmSync(from, { force: true });
}

function migrateJobFiles(dir: string): void {
  const old = path.join(dir, "candidatos");
  const cand = path.join(dir, "candidates");
  move(old, cand);
  move(path.join(cand, "contextos"), path.join(cand, "contexts"));
  move(path.join(cand, "clipes"), path.join(cand, "clips"));
  // the candidates are in the database; the worker's old list is not read again
  fs.rmSync(path.join(cand, "candidatos.json"), { force: true });
  tracksFile(path.join(dir, "trilhas.json.gz"), path.join(dir, "tracks.json.gz"));
  rewriteJson(path.join(dir, "trilhas_meta.json"), path.join(dir, "tracks_meta.json"), trackMeta);
  rewriteJson(path.join(dir, "pontos.json"), path.join(dir, "points.json"), (p: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(p).map(([k, v]) => [cat(k), v])),
  );
  rewriteJson(path.join(dir, "linhas.json"), path.join(dir, "lines.json"), (l: OldLine[]) => JSON.parse(lines(JSON.stringify(l))));
  move(path.join(dir, "sugestoes_erros.jsonl"), path.join(dir, "suggestion_errors.jsonl"));
  fs.rmSync(path.join(dir, "previa.jpg"), { force: true });
}

type OldPlan = { categorias?: string[] | null; videos: { job?: string; titulo: string; video: string; trilhas: string; linhas: OldLine[]; eventos: { id: number; frame: number; linha_id: string | null; categoria: string; direcao: string | null; track: string }[] }[] };
type OldReport = { gerado_em: string; codec: string; totais: Record<string, Record<string, number>>; por_sentido: Record<string, Record<string, unknown>>; videos: { titulo: string; inicio_no_final_s: number; duracao_s: number; totais: Record<string, Record<string, number>> }[]; eventos: { video: string; candidato: number; linha: string; categoria: string; sentido: string; tempo_no_video_s: number; tempo_no_final_s: number }[] };

const byLine = <T,>(o: Record<string, Record<string, T>>) =>
  Object.fromEntries(Object.entries(o ?? {}).map(([line, cats]) => [line, Object.fromEntries(Object.entries(cats).map(([c, v]) => [cat(c), v]))]));

function migrateRenderFiles(dir: string): void {
  rewriteJson(path.join(dir, "plano.json"), path.join(dir, "plan.json"), (p: OldPlan) => ({
    categories: p.categorias ? p.categorias.map(cat) : null,
    videos: p.videos.map((v) => ({
      job: v.job,
      title: v.titulo,
      video: v.video,
      tracks: v.trilhas?.replace(/trilhas\.json\.gz$/, "tracks.json.gz"),
      lines: JSON.parse(lines(JSON.stringify(v.linhas))),
      events: v.eventos.map((e) => ({ id: e.id, frame: e.frame, line_id: e.linha_id, category: cat(e.categoria), direction: e.direcao, track: e.track && trackKey(e.track) })),
    })),
  }));
  rewriteJson(path.join(dir, "relatorio.json"), path.join(dir, "report.json"), (r: OldReport) => ({
    generated_at: r.gerado_em,
    codec: r.codec,
    totals: byLine(r.totais),
    by_direction: byLine(r.por_sentido),
    videos: r.videos.map((v) => ({ title: v.titulo, start_in_final_s: v.inicio_no_final_s, duration_s: v.duracao_s, totals: byLine(v.totais) })),
    events: r.eventos.map((e) => ({ video: e.video, candidate: e.candidato, line: e.linha, category: cat(e.categoria), direction: e.sentido, time_in_video_s: e.tempo_no_video_s, time_in_final_s: e.tempo_no_final_s })),
  }));
  move(path.join(dir, "video_final.mp4"), path.join(dir, "final_video.mp4"));
  move(path.join(dir, "eventos.csv"), path.join(dir, "events.csv"));
}

function subdirs(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

export function migrateLegacy(d: DatabaseSync, dataDir: string): void {
  if (!tableExists(d, "candidatos")) return;
  console.log("[legacy] moving data from version 0.0.7 or earlier to the new names…");

  for (const dir of subdirs(path.join(dataDir, "jobs"))) {
    try {
      migrateJobFiles(dir);
    } catch (e) {
      console.error(`[legacy] ${dir}: ${(e as Error).message}`);
    }
  }
  for (const dir of subdirs(path.join(dataDir, "renders"))) {
    try {
      migrateRenderFiles(dir);
    } catch (e) {
      console.error(`[legacy] ${dir}: ${(e as Error).message}`);
    }
  }

  const cameras = rows(d, "cameras");
  const groups = rows(d, "grupos");
  const settings = rows(d, "configuracoes");
  const jobs = rows(d, "jobs");
  const candidates = rows(d, "candidatos");
  const renders = rows(d, "renders");

  d.exec("PRAGMA foreign_keys = OFF");
  d.exec("BEGIN");
  try {
    for (const t of ["candidatos", "renders", "jobs", "cameras", "grupos", "configuracoes"]) d.exec(`DROP TABLE IF EXISTS ${t}`);
    d.exec(SCHEMA);
    const ins = (table: string, data: Record<string, unknown>) => {
      const keys = Object.keys(data);
      d.prepare(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(
        ...(keys.map((k) => data[k] ?? null) as (string | number | null)[]),
      );
    };
    for (const c of cameras) ins("cameras", { id: c.id, name: c.nome, lines: lines(c.linhas as string), area: c.area, created_at: c.criado_em });
    for (const g of groups) ins("groups", { id: g.id, name: g.nome, created_at: g.criado_em });
    for (const s of settings) ins("settings", { key: SETTING[s.chave as string] ?? s.chave, value: s.valor });
    for (const j of jobs) {
      ins("jobs", {
        id: j.id,
        drive_link: j.link_drive,
        drive_id: j.drive_id,
        file_name: j.nome_arquivo,
        camera_id: j.camera_id,
        lines: lines(j.linhas as string),
        area: j.area,
        video_file: j.arquivo_video,
        group_id: j.grupo_id,
        fps: j.fps,
        width: j.largura,
        height: j.altura,
        duration_s: j.duracao_s,
        status: JOB_STATUS[j.status as string] ?? j.status,
        progress: j.progresso,
        message: j.mensagem,
        error: j.erro,
        created_at: j.criado_em,
        updated_at: j.atualizado_em,
      });
    }
    for (const c of candidates) {
      ins("candidates", {
        id: c.id,
        job_id: c.job_id,
        track: trackKey(c.track as string),
        line_id: c.linha_id,
        frame: c.frame,
        time_s: c.tempo_s,
        direction: c.direcao,
        bbox: c.bbox,
        yolo_class: cat(c.classe_yolo),
        yolo_conf: c.conf_yolo,
        alternative: cat(c.alternativa),
        origin: ORIGIN[c.origem as string] ?? c.origem,
        n_obs: c.n_obs,
        filmstrip: mediaPath(c.filmstrip),
        context: mediaPath(c.contexto),
        clip: mediaPath(c.clipe),
        llm_suggestion: cat(c.sugestao_llm),
        llm_cost: c.custo_llm,
        llm_conf: c.conf_llm,
        llm_reason: c.justificativa_llm,
        llm_model: c.modelo_llm,
        llm_status: LLM_STATUS[c.status_llm as string] ?? "pending",
        llm_error: c.erro_llm,
        label: cat(c.rotulo),
        reviewed_at: c.revisado_em,
      });
    }
    for (const r of renders) {
      ins("renders", {
        id: r.id,
        name: r.nome,
        jobs: r.jobs,
        categories: categoryList(r.categorias as string | null),
        status: RENDER_STATUS[r.status as string] ?? r.status,
        progress: r.progresso,
        message: r.mensagem,
        error: r.erro,
        created_at: r.criado_em,
        updated_at: r.atualizado_em,
      });
    }
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  } finally {
    d.exec("PRAGMA foreign_keys = ON");
  }
  console.log(`[legacy] done: ${jobs.length} videos, ${candidates.length} candidates, ${renders.length} final videos`);
}
