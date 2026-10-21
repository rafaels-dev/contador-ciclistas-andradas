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
  track_id           INTEGER NOT NULL,
  linha_id           TEXT,             -- linha cruzada (NULL = modo sem linha)
  frame              INTEGER NOT NULL, -- frame do evento (cruzamento ou meio da trajetória)
  tempo_s            REAL NOT NULL,
  direcao            TEXT,             -- sentido em relação à linha: 'a' | 'b'
  bbox               TEXT,             -- JSON [x1,y1,x2,y2] em px no frame do evento
  classe_yolo        TEXT,
  conf_yolo          REAL,
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

let instancia: DatabaseSync | undefined;

export function db(): DatabaseSync {
  if (!instancia) {
    fs.mkdirSync(DIR_DADOS, { recursive: true });
    instancia = new DatabaseSync(ARQUIVO_DB);
    instancia.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    instancia.exec(SCHEMA);
  }
  return instancia;
}

export function listarJobs(): Job[] {
  return db().prepare("SELECT * FROM jobs ORDER BY criado_em DESC").all() as Job[];
}

export function obterJob(id: string): Job | undefined {
  return db().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Job | undefined;
}

export function criarJob(dados: { id: string; link_drive: string; drive_id: string }): void {
  db()
    .prepare("INSERT INTO jobs (id, link_drive, drive_id) VALUES (?, ?, ?)")
    .run(dados.id, dados.link_drive, dados.drive_id);
}
