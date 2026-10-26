import path from "node:path";

// turbopackIgnore: sem ele o rastreio de arquivos do build tenta incluir o
// repositório inteiro e os vídeos de data/ (dezenas de GB) no servidor

/**
 * Raiz do repositório (onde ficam config.py, requirements.txt, os pesos do
 * YOLO e o worker Python). No app desktop, a pasta de recursos do instalador.
 */
export const RAIZ_REPO = process.env.CONTADOR_RAIZ ?? path.resolve(/* turbopackIgnore: true */ process.cwd(), "..");

/** Dados locais do app (banco + arquivos por job). Ignorado pelo git. */
export const DIR_DADOS = process.env.CONTADOR_DADOS ?? path.join(/* turbopackIgnore: true */ process.cwd(), "data");

export const ARQUIVO_DB = path.join(DIR_DADOS, "app.db");

export function dirJob(jobId: string): string {
  return path.join(DIR_DADOS, "jobs", jobId);
}

export function dirRender(renderId: string): string {
  return path.join(DIR_DADOS, "renders", renderId);
}
