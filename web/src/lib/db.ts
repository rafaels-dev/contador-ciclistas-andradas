import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { ARQUIVO_DB, DIR_DADOS } from "./paths";

/**
 * Fluxo de um job (ordem fixa — o render só acontece depois da revisão humana):
 *   baixando → aguardando_linhas (usuário desenha as linhas no 1º frame)
 *   → detectando → sugerindo (OpenRouter p/ TODO candidato)
 *   → aguardando_revisao → renderizando → concluido
 * Qualquer etapa pode ir para `erro` (mensagem em jobs.erro).
 */
export const STATUS_JOB = [
  "baixando",
  "aguardando_linhas",
  "detectando",
  "sugerindo",
  "aguardando_revisao",
  "renderizando",
  "concluido",
  "erro",
] as const;
export type StatusJob = (typeof STATUS_JOB)[number];

export const CATEGORIAS = ["ciclistas", "pedestres", "automoveis", "motocicletas"] as const;
export type Categoria = (typeof CATEGORIAS)[number];

/**
 * Linha de contagem desenhada pelo usuário sobre o 1º frame: um segmento em
 * qualquer ângulo (ciclovias têm geometrias diferentes por câmera). Coordenadas
 * normalizadas 0–1 para independer da resolução. Sem nenhuma linha, cada
 * trajetória com deslocamento relevante vira um candidato.
 */
export type Linha = {
  id: string;
  nome: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type Job = {
  id: string;
  link_drive: string;
  drive_id: string;
  nome_arquivo: string | null;
  camera_id: string | null;
  linhas: string; // JSON de Linha[] — cópia congelada no momento da detecção
  arquivo_video: string | null; // relativo ao dir do job
  fps: number | null;
  largura: number | null;
  altura: number | null;
  duracao_s: number | null;
  status: StatusJob;
  progresso: number;
  mensagem: string | null;
  erro: string | null;
  criado_em: string;
  atualizado_em: string;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cameras (
  id          TEXT PRIMARY KEY,
  nome        TEXT NOT NULL,
  linhas      TEXT NOT NULL DEFAULT '[]',
  criado_em   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jobs (
  id             TEXT PRIMARY KEY,
  link_drive     TEXT NOT NULL,
  drive_id       TEXT NOT NULL,
  nome_arquivo   TEXT,
  camera_id      TEXT REFERENCES cameras(id),
  linhas         TEXT NOT NULL DEFAULT '[]',
  arquivo_video  TEXT,
  fps            REAL,
  largura        INTEGER,
  altura         INTEGER,
  duracao_s      REAL,
  status         TEXT NOT NULL DEFAULT 'baixando',
  progresso      REAL NOT NULL DEFAULT 0,
  mensagem       TEXT,
  erro           TEXT,
  criado_em      TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS candidatos (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id             TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  track              TEXT NOT NULL,    -- '<grupo>:<tid>' (pes|bic|aut|mot)
  linha_id           TEXT,             -- linha cruzada (NULL = modo sem linha)
  frame              INTEGER NOT NULL, -- frame do evento (cruzamento ou meio da trajetória)
  tempo_s            REAL NOT NULL,
  direcao            TEXT,             -- 'A→B' | 'B→A' em relação à linha
  bbox               TEXT,             -- JSON [x1,y1,x2,y2] em px no frame do evento
  classe_yolo        TEXT,             -- categoria sugerida pelo detector
  conf_yolo          REAL,
  alternativa        TEXT,             -- outra categoria plausível (bike×moto)
  origem             TEXT,             -- track | pessoa_com_bicicleta | pessoa_com_moto
  n_obs              INTEGER,
  filmstrip          TEXT,             -- caminho relativo ao dir do job
  clipe              TEXT,
  sugestao_llm       TEXT,             -- categoria sugerida pelo OpenRouter
  conf_llm           REAL,
  justificativa_llm  TEXT,
  modelo_llm         TEXT,
  status_llm         TEXT NOT NULL DEFAULT 'pendente', -- pendente | ok | falhou
  rotulo             TEXT,             -- decisão humana: categoria ou 'descartado'
  revisado_em        TEXT
);
CREATE INDEX IF NOT EXISTS idx_candidatos_job ON candidatos(job_id);
`;

// globalThis: sobrevive ao hot reload do `next dev` (senão cada recarga
// reabriria o banco e marcaria como interrompidos os jobs em andamento)
const g = globalThis as { __contadorDb?: DatabaseSync };

export function db(): DatabaseSync {
  if (!g.__contadorDb) {
    fs.mkdirSync(DIR_DADOS, { recursive: true });
    const d = new DatabaseSync(ARQUIVO_DB);
    d.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    d.exec(SCHEMA);
    // processo novo: nenhum worker sobreviveu ao reinício do servidor
    d.prepare(
      `UPDATE jobs SET status = 'erro', erro = 'Interrompido: o servidor foi reiniciado.',
       atualizado_em = datetime('now') WHERE status IN ('baixando', 'detectando')`,
    ).run();
    g.__contadorDb = d;
  }
  return g.__contadorDb;
}

// node:sqlite devolve objetos com protótipo nulo, que o React não serializa
// para Client Components — converte em objetos comuns.
function simples(linha: object): object {
  return { ...linha };
}

export type Candidato = {
  id: number;
  job_id: string;
  track: string;
  linha_id: string | null;
  frame: number;
  tempo_s: number;
  direcao: string | null;
  bbox: string | null;
  classe_yolo: Categoria | null;
  conf_yolo: number | null;
  alternativa: Categoria | null;
  origem: string | null;
  n_obs: number | null;
  filmstrip: string | null;
  clipe: string | null;
  sugestao_llm: Categoria | null;
  conf_llm: number | null;
  justificativa_llm: string | null;
  modelo_llm: string | null;
  status_llm: "pendente" | "ok" | "falhou";
  rotulo: Categoria | "descartado" | null;
  revisado_em: string | null;
};

export type Camera = { id: string; nome: string; linhas: string; criado_em: string };

type CamposJob = Partial<Omit<Job, "id" | "criado_em" | "atualizado_em">>;

export function atualizarJob(id: string, campos: CamposJob): void {
  const chaves = Object.keys(campos) as (keyof CamposJob)[];
  if (!chaves.length) return;
  const sets = chaves.map((k) => `${k} = ?`).join(", ");
  db()
    .prepare(`UPDATE jobs SET ${sets}, atualizado_em = datetime('now') WHERE id = ?`)
    .run(...chaves.map((k) => campos[k] ?? null), id);
}

export function listarCandidatos(jobId: string): Candidato[] {
  return db()
    .prepare("SELECT * FROM candidatos WHERE job_id = ? ORDER BY frame, id")
    .all(jobId)
    .map(simples) as Candidato[];
}

export function substituirCandidatos(
  jobId: string,
  itens: Omit<Candidato, "id" | "job_id" | "sugestao_llm" | "conf_llm" | "justificativa_llm" | "modelo_llm" | "status_llm" | "rotulo" | "revisado_em">[],
): void {
  const d = db();
  d.exec("BEGIN");
  try {
    d.prepare("DELETE FROM candidatos WHERE job_id = ?").run(jobId);
    const ins = d.prepare(
      `INSERT INTO candidatos (job_id, track, linha_id, frame, tempo_s, direcao, bbox, classe_yolo,
         conf_yolo, alternativa, origem, n_obs, filmstrip, clipe)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const c of itens) {
      ins.run(jobId, c.track, c.linha_id, c.frame, c.tempo_s, c.direcao, c.bbox, c.classe_yolo,
        c.conf_yolo, c.alternativa, c.origem, c.n_obs, c.filmstrip, c.clipe);
    }
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

export function listarCameras(): Camera[] {
  return db().prepare("SELECT * FROM cameras ORDER BY nome").all().map(simples) as Camera[];
}

export function salvarCamera(id: string, nome: string, linhas: Linha[]): void {
  db()
    .prepare(
      `INSERT INTO cameras (id, nome, linhas) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET nome = excluded.nome, linhas = excluded.linhas`,
    )
    .run(id, nome, JSON.stringify(linhas));
}

export function listarJobs(): Job[] {
  return db().prepare("SELECT * FROM jobs ORDER BY criado_em DESC").all().map(simples) as Job[];
}

export function obterJob(id: string): Job | undefined {
  const linha = db().prepare("SELECT * FROM jobs WHERE id = ?").get(id);
  return linha ? (simples(linha) as Job) : undefined;
}

export function criarJob(dados: { id: string; link_drive: string; drive_id: string }): void {
  db()
    .prepare("INSERT INTO jobs (id, link_drive, drive_id) VALUES (?, ?, ?)")
    .run(dados.id, dados.link_drive, dados.drive_id);
}
