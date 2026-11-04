import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import zlib from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { migrateLegacy, movedVideo } from "./legacy";

// The database and the job/render folders exactly as version 0.0.7 left them.
const OLD_SCHEMA = `
CREATE TABLE grupos (id TEXT PRIMARY KEY, nome TEXT NOT NULL, criado_em TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE configuracoes (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
CREATE TABLE cameras (id TEXT PRIMARY KEY, nome TEXT NOT NULL, linhas TEXT NOT NULL DEFAULT '[]', area TEXT, criado_em TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE jobs (
  id TEXT PRIMARY KEY, link_drive TEXT NOT NULL, drive_id TEXT NOT NULL, nome_arquivo TEXT, camera_id TEXT,
  linhas TEXT NOT NULL DEFAULT '[]', arquivo_video TEXT, fps REAL, largura INTEGER, altura INTEGER, duracao_s REAL,
  status TEXT NOT NULL DEFAULT 'baixando', progresso REAL NOT NULL DEFAULT 0, mensagem TEXT, erro TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')), atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  grupo_id TEXT, area TEXT
);
CREATE TABLE candidatos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, track TEXT NOT NULL, linha_id TEXT, frame INTEGER NOT NULL,
  tempo_s REAL NOT NULL, direcao TEXT, bbox TEXT, classe_yolo TEXT, conf_yolo REAL, alternativa TEXT, origem TEXT,
  n_obs INTEGER, filmstrip TEXT, contexto TEXT, clipe TEXT, sugestao_llm TEXT, custo_llm REAL, conf_llm REAL,
  justificativa_llm TEXT, modelo_llm TEXT, status_llm TEXT NOT NULL DEFAULT 'pendente', erro_llm TEXT, rotulo TEXT, revisado_em TEXT
);
CREATE TABLE renders (
  id TEXT PRIMARY KEY, nome TEXT NOT NULL, jobs TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'na_fila',
  progresso REAL NOT NULL DEFAULT 0, mensagem TEXT, erro TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')), atualizado_em TEXT NOT NULL DEFAULT (datetime('now')), categorias TEXT
);`;

const root = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-test-"));
const opened: DatabaseSync[] = [];
afterAll(() => {
  for (const d of opened) d.close(); // Windows does not delete an open file
  fs.rmSync(root, { recursive: true, force: true });
});

const OLD_LINES = JSON.stringify([{ id: "l1", nome: "Ciclovia", x1: 0, y1: 0.5, x2: 1, y2: 0.5, categorias: ["ciclistas", "patinetes"] }]);

function oldData(): { d: DatabaseSync; dir: string } {
  const dir = fs.mkdtempSync(path.join(root, "data-"));
  const job = path.join(dir, "jobs", "j1");
  fs.mkdirSync(path.join(job, "candidatos", "contextos"), { recursive: true });
  fs.mkdirSync(path.join(job, "candidatos", "clipes"), { recursive: true });
  fs.writeFileSync(path.join(job, "candidatos", "contextos", "c1.jpg"), "jpg");
  fs.writeFileSync(path.join(job, "candidatos", "candidatos.json"), "[]");
  fs.writeFileSync(path.join(job, "linhas.json"), OLD_LINES);
  fs.writeFileSync(path.join(job, "pontos.json"), JSON.stringify({ ciclistas: [[1, 2]], automoveis: [] }));
  fs.writeFileSync(path.join(job, "trilhas_meta.json"), JSON.stringify({ largura: 1920, altura: 1080, area_arg: null }));
  fs.writeFileSync(path.join(job, "previa.jpg"), "jpg");
  const tracks = { meta: { largura: 1920 }, tracks: [{ grupo: "bic", tid: 7, frames: [1, 2], caixas: [[0, 0, 1, 1]], classes: {}, conf_soma: 1.5, n_bike: 2, n_moto: 0, vizinhos: { "pes:3": 2 }, emendas: ["bic:5"] }] };
  fs.writeFileSync(path.join(job, "trilhas.json.gz"), zlib.gzipSync(JSON.stringify(tracks)));

  const render = path.join(dir, "renders", "r1");
  fs.mkdirSync(render, { recursive: true });
  fs.writeFileSync(path.join(render, "video_final.mp4"), "mp4");
  fs.writeFileSync(path.join(render, "eventos.csv"), "csv");
  fs.writeFileSync(
    path.join(render, "relatorio.json"),
    JSON.stringify({
      gerado_em: "2026-10-01", codec: "h264_nvenc", totais: { Ciclovia: { ciclistas: 3 } }, por_sentido: { Ciclovia: { ciclistas: { "A→B": 3 } } },
      videos: [{ titulo: "cam.mp4", inicio_no_final_s: 0, duracao_s: 60, totais: { Ciclovia: { ciclistas: 3 } } }],
      eventos: [{ video: "cam.mp4", candidato: 1, linha: "Ciclovia", categoria: "ciclistas", sentido: "A→B", tempo_no_video_s: 1.5, tempo_no_final_s: 1.5 }],
    }),
  );

  const d = new DatabaseSync(path.join(dir, "app.db"));
  opened.push(d);
  d.exec(OLD_SCHEMA);
  d.exec(`INSERT INTO grupos (id, nome) VALUES ('g1', 'Centro')`);
  d.exec(`INSERT INTO configuracoes (chave, valor) VALUES ('placa', 'cpu'), ('primeiro_acesso', '2026-10-01')`);
  d.prepare(`INSERT INTO cameras (id, nome, linhas) VALUES ('cam4', 'CAM 4', ?)`).run(OLD_LINES);
  d.prepare(
    `INSERT INTO jobs (id, link_drive, drive_id, nome_arquivo, linhas, arquivo_video, fps, largura, altura, duracao_s, status, progresso, grupo_id)
     VALUES ('j1', 'https://drive', 'abc', 'cam.mp4', ?, 'video.mp4', 15, 1920, 1080, 60, 'aguardando_revisao', 1, 'g1')`,
  ).run(OLD_LINES);
  d.exec(
    `INSERT INTO candidatos (job_id, track, linha_id, frame, tempo_s, direcao, classe_yolo, origem, filmstrip, contexto, clipe,
       sugestao_llm, modelo_llm, status_llm, rotulo)
     VALUES ('j1', 'bic:7', 'l1', 10, 0.7, 'A→B', 'ciclistas', 'pessoa_com_bicicleta', 'candidatos/f1.jpg', 'candidatos/contextos/c1.jpg',
       'candidatos/clipes/c1.mp4', 'patinetes', 'anthropic/claude-haiku-5.5', 'ok', 'descartado'),
            ('j1', 'mov:2', 'l1', 20, 1.3, 'B→A', 'outros', 'movimento', NULL, NULL, NULL, NULL, NULL, 'falhou', NULL)`,
  );
  d.exec(`INSERT INTO renders (id, nome, jobs, status, categorias) VALUES ('r1', 'Centro', '["j1"]', 'pronto', '["ciclistas"]')`);
  return { d, dir };
}

describe("migrateLegacy (0.0.7 → English names)", () => {
  const { d, dir } = oldData();
  migrateLegacy(d, dir);
  const one = (sql: string) => ({ ...(d.prepare(sql).get() as Record<string, unknown>) });

  it("moves the tables, columns and stored values", () => {
    expect(one("SELECT name FROM groups")).toEqual({ name: "Centro" });
    expect(d.prepare("SELECT key, value FROM settings ORDER BY key").all().map((r) => ({ ...r }))).toEqual([
      { key: "first_run", value: "2026-10-01" },
      { key: "gpu", value: "cpu" },
    ]);
    const job = one("SELECT * FROM jobs");
    expect(job).toMatchObject({ drive_link: "https://drive", file_name: "cam.mp4", video_file: "video.mp4", width: 1920, status: "awaiting_review", group_id: "g1" });
    expect(JSON.parse(job.lines as string)).toEqual([{ id: "l1", name: "Ciclovia", x1: 0, y1: 0.5, x2: 1, y2: 0.5, categories: ["cyclists", "kick_scooters"] }]);
    expect(JSON.parse(one("SELECT lines FROM cameras").lines as string)[0].categories).toEqual(["cyclists", "kick_scooters"]);
  });

  it("translates the candidates, keeping the human decisions", () => {
    const rows = d.prepare("SELECT * FROM candidates ORDER BY id").all().map((r) => ({ ...r }));
    expect(rows[0]).toMatchObject({
      track: "bike:7", line_id: "l1", time_s: 0.7, direction: "A→B", yolo_class: "cyclists", origin: "person_on_bicycle",
      filmstrip: "candidates/f1.jpg", context: "candidates/contexts/c1.jpg", clip: "candidates/clips/c1.mp4",
      llm_suggestion: "kick_scooters", llm_status: "ok", label: "discarded",
    });
    expect(rows[1]).toMatchObject({ track: "motion:2", yolo_class: "other", origin: "motion", llm_status: "failed", label: null });
  });

  it("translates the final videos", () => {
    expect(one("SELECT name, status, categories FROM renders")).toEqual({ name: "Centro", status: "ready", categories: '["cyclists"]' });
  });

  it("moves the files of each video, so nothing is detected again", () => {
    const job = path.join(dir, "jobs", "j1");
    expect(fs.existsSync(path.join(job, "candidates", "contexts", "c1.jpg"))).toBe(true);
    expect(fs.existsSync(path.join(job, "candidates", "clips"))).toBe(true);
    expect(fs.existsSync(path.join(job, "candidatos"))).toBe(false);
    expect(fs.existsSync(path.join(job, "previa.jpg"))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(job, "lines.json"), "utf8"))[0].categories).toEqual(["cyclists", "kick_scooters"]);
    expect(JSON.parse(fs.readFileSync(path.join(job, "points.json"), "utf8"))).toEqual({ cyclists: [[1, 2]], cars: [] });
    expect(JSON.parse(fs.readFileSync(path.join(job, "tracks_meta.json"), "utf8"))).toMatchObject({ width: 1920, height: 1080 });
    const tracks = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(job, "tracks.json.gz"))).toString("utf8"));
    expect(tracks.tracks[0]).toMatchObject({ group: "bike", tid: 7, boxes: [[0, 0, 1, 1]], conf_sum: 1.5, neighbors: { "ped:3": 2 }, splices: ["bike:5"] });
    expect(fs.existsSync(path.join(job, "trilhas.json.gz"))).toBe(false);
  });

  it("moves the files of each final video", () => {
    const render = path.join(dir, "renders", "r1");
    expect(fs.existsSync(path.join(render, "final_video.mp4"))).toBe(true);
    expect(fs.existsSync(path.join(render, "events.csv"))).toBe(true);
    const report = JSON.parse(fs.readFileSync(path.join(render, "report.json"), "utf8"));
    expect(report).toMatchObject({ generated_at: "2026-10-01", totals: { Ciclovia: { cyclists: 3 } }, videos: [{ title: "cam.mp4", duration_s: 60 }] });
    expect(report.events[0]).toEqual({ video: "cam.mp4", candidate: 1, line: "Ciclovia", category: "cyclists", direction: "A→B", time_in_video_s: 1.5, time_in_final_s: 1.5 });
  });

  it("running again on an already migrated database does nothing", () => {
    expect(() => migrateLegacy(d, dir)).not.toThrow();
    expect(one("SELECT COUNT(*) AS n FROM candidates")).toEqual({ n: 2 });
  });
});

describe("movedVideo", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "moved-video-"));
  fs.mkdirSync(path.join(root, "evaluation", "videos"), { recursive: true });
  fs.writeFileSync(path.join(root, "evaluation", "videos", "a.mp4"), "");

  it("follows a local video from avaliacao/ to evaluation/", () => {
    expect(movedVideo(path.join(root, "avaliacao", "videos", "a.mp4"))).toBe(path.join(root, "evaluation", "videos", "a.mp4"));
  });

  it("keeps the path when the file is still there or did not move", () => {
    expect(movedVideo(path.join(root, "evaluation", "videos", "a.mp4"))).toBe(path.join(root, "evaluation", "videos", "a.mp4"));
    expect(movedVideo(path.join(root, "avaliacao", "videos", "b.mp4"))).toBe(path.join(root, "avaliacao", "videos", "b.mp4"));
    expect(movedVideo("video.mp4")).toBe("video.mp4");
  });

  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
});
