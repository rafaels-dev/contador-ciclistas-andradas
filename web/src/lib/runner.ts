import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { atualizarJob, obterJob, substituirCandidatos, type Categoria, type Linha } from "./db";
import { baixarDoDrive } from "./drive";
import { RAIZ_REPO, dirJob } from "./paths";

/**
 * Orquestra as etapas pesadas de um job fora do ciclo de request: download
 * (Node) e scripts Python do worker/ (GPU). Detecções rodam em fila única —
 * a GPU de 8 GB não comporta dois vídeos em paralelo com folga.
 */

const PYTHON = process.env.PYTHON ?? "python3";

type EventoWorker =
  | { tipo: "progresso"; etapa: string; p: number; fps?: number; candidatos?: number }
  | { tipo: "info"; fps: number; frames: number; largura: number; altura: number; duracao_s: number }
  | { tipo: "fim"; candidatos: number }
  | { tipo: "erro"; mensagem: string };

const g = globalThis as { __contadorFilaGpu?: Promise<unknown> };

function naFilaDaGpu<T>(tarefa: () => Promise<T>): Promise<T> {
  const anterior = g.__contadorFilaGpu ?? Promise.resolve();
  const proxima = anterior.catch(() => undefined).then(tarefa);
  g.__contadorFilaGpu = proxima;
  return proxima;
}

function rodarWorker(script: string, args: string[], aoEvento: (e: EventoWorker) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON, [path.join("worker", script), ...args], {
      cwd: RAIZ_REPO,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    let erroWorker: string | null = null;
    let stderr = "";
    readline.createInterface({ input: proc.stdout }).on("line", (linha) => {
      let ev: EventoWorker;
      try {
        ev = JSON.parse(linha);
      } catch {
        return; // saída solta de bibliotecas
      }
      if (ev.tipo === "erro") erroWorker = ev.mensagem;
      aoEvento(ev);
    });
    proc.stderr.on("data", (d) => {
      stderr = (stderr + d).slice(-4000);
    });
    proc.on("error", reject);
    proc.on("close", (codigo) => {
      if (codigo === 0) resolve();
      else reject(new Error(erroWorker ?? `worker/${script} saiu com código ${codigo}: ${stderr.trim().split("\n").pop()}`));
    });
  });
}

function falhar(jobId: string, e: unknown): void {
  atualizarJob(jobId, { status: "erro", erro: e instanceof Error ? e.message : String(e), mensagem: null });
}

/** Etapa 1: download + metadados + 1º frame → aguardando_linhas. */
export function iniciarDownload(jobId: string): void {
  void (async () => {
    const job = obterJob(jobId);
    if (!job) return;
    const dir = dirJob(jobId);
    fs.mkdirSync(dir, { recursive: true });
    const destino = path.join(dir, "video.mp4");
    atualizarJob(jobId, { status: "baixando", progresso: 0, erro: null, mensagem: "Baixando do Google Drive…" });

    if (job.drive_id === "local") {
      // modo de teste (CONTADOR_PERMITIR_LOCAL=1): link é um caminho local
      fs.rmSync(destino, { force: true });
      fs.symlinkSync(path.resolve(job.link_drive), destino);
      atualizarJob(jobId, { nome_arquivo: path.basename(job.link_drive) });
    } else {
      const { nome } = await baixarDoDrive(job.drive_id, destino, (feito, total) => {
        const mb = (feito / 1e6).toFixed(0);
        atualizarJob(jobId, {
          progresso: total ? feito / total : 0,
          mensagem: total ? `Baixando… ${mb} de ${(total / 1e6).toFixed(0)} MB` : `Baixando… ${mb} MB`,
        });
      });
      atualizarJob(jobId, { nome_arquivo: nome });
    }

    atualizarJob(jobId, { mensagem: "Lendo o vídeo…", progresso: 1 });
    await rodarWorker("info.py", [destino, dir], (ev) => {
      if (ev.tipo === "info") {
        atualizarJob(jobId, {
          arquivo_video: "video.mp4",
          fps: ev.fps,
          largura: ev.largura,
          altura: ev.altura,
          duracao_s: ev.duracao_s,
        });
      }
    });
    atualizarJob(jobId, { status: "aguardando_linhas", mensagem: null, progresso: 0 });
  })().catch((e) => falhar(jobId, e));
}

type CandidatoWorker = {
  id: number;
  track: string;
  linha_id: string | null;
  frame: number;
  tempo_s: number;
  direcao: string | null;
  bbox: number[];
  classe_yolo: Categoria;
  conf_yolo: number;
  alternativa: Categoria | null;
  origem: string;
  n_obs: number;
  filmstrip: string;
  clipe: string;
};

const ROTULO_ETAPA: Record<string, string> = {
  detectando: "Detectando e rastreando objetos",
  filmstrips: "Gerando miniaturas",
  clipes: "Gerando clipes",
};

/** Etapa 2: detecção + candidatos (fila da GPU) → sugerindo. */
export function iniciarDeteccao(jobId: string, linhas: Linha[]): void {
  const dir = dirJob(jobId);
  const arqLinhas = path.join(dir, "linhas.json");
  fs.writeFileSync(arqLinhas, JSON.stringify(linhas));
  fs.rmSync(path.join(dir, "candidatos"), { recursive: true, force: true });
  atualizarJob(jobId, {
    status: "detectando",
    linhas: JSON.stringify(linhas),
    progresso: 0,
    erro: null,
    mensagem: "Na fila da GPU…",
  });

  void naFilaDaGpu(async () => {
    const saida = path.join(dir, "candidatos");
    const args = ["--video", path.join(dir, "video.mp4"), "--saida", saida, "--linhas", arqLinhas];
    if (process.env.CONTADOR_FIM_S) args.push("--fim", process.env.CONTADOR_FIM_S); // testes rápidos
    await rodarWorker("detectar.py", args, (ev) => {
      if (ev.tipo !== "progresso") return;
      const fps = ev.fps ? ` (${ev.fps} fps)` : "";
      const n = ev.candidatos != null ? ` — ${ev.candidatos} candidatos` : "";
      atualizarJob(jobId, { progresso: ev.p, mensagem: `${ROTULO_ETAPA[ev.etapa] ?? ev.etapa}…${fps}${n}` });
    });

    const itens = JSON.parse(fs.readFileSync(path.join(saida, "candidatos.json"), "utf8")) as CandidatoWorker[];
    substituirCandidatos(
      jobId,
      itens.map((c) => ({
        track: c.track,
        linha_id: c.linha_id,
        frame: c.frame,
        tempo_s: c.tempo_s,
        direcao: c.direcao,
        bbox: JSON.stringify(c.bbox),
        classe_yolo: c.classe_yolo,
        conf_yolo: c.conf_yolo,
        alternativa: c.alternativa,
        origem: c.origem,
        n_obs: c.n_obs,
        filmstrip: `candidatos/${c.filmstrip}`,
        clipe: `candidatos/${c.clipe}`,
      })),
    );
    // Fase 2: aqui entra a sugestão do OpenRouter para todo candidato.
    atualizarJob(jobId, { status: "sugerindo", progresso: 0, mensagem: `${itens.length} candidatos detectados.` });
  }).catch((e) => falhar(jobId, e));
}
