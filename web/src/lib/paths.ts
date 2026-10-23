import path from "node:path";

/** Raiz do repositório (onde ficam contador/, config.py, .env e o worker Python). */
export const RAIZ_REPO = path.resolve(process.cwd(), "..");

/** Dados locais do app (banco + arquivos por job). Ignorado pelo git. */
export const DIR_DADOS = process.env.CONTADOR_DADOS ?? path.join(process.cwd(), "data");

export const ARQUIVO_DB = path.join(DIR_DADOS, "app.db");

export function dirJob(jobId: string): string {
  return path.join(DIR_DADOS, "jobs", jobId);
}

export function dirRender(renderId: string): string {
  return path.join(DIR_DADOS, "renders", renderId);
}
