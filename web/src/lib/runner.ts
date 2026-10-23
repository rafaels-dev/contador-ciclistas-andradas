import "./env";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import {
  atualizarJob,
  atualizarRender,
  listarCandidatos,
  obterRender,
  obterJob,
  registrarSugestao,
  resumoSugestoes,
  substituirCandidatos,
  type Categoria,
  type Linha,
} from "./db";
import { baixarDoDrive } from "./drive";
import { ErroOpenRouter, sugerirCategoria } from "./openrouter";
import { RAIZ_REPO, dirJob, dirRender } from "./paths";

/**
 * Orquestra as etapas pesadas de um job fora do ciclo de request: download
 * (Node) e scripts Python do worker/ (GPU). Detecções rodam em fila única —
 * a GPU de 8 GB não comporta dois vídeos em paralelo com folga.
 */

const PYTHON = process.env.PYTHON ?? "python3";

type EventoWorker =
  | { tipo: "progresso"; etapa: string; p: number; fps?: number; candidatos?: number; video?: number; videos?: number }
  | { tipo: "info"; fps: number; frames: number; largura: number; altura: number; duracao_s: number }
  | { tipo: "fim"; candidatos?: number; eventos?: number; duracao_s?: number; codec?: string }
  | { tipo: "erro"; mensagem: string };

const g = globalThis as {
  __contadorFilaGpu?: Promise<unknown>;
  __contadorDownloads?: Map<string, AbortController>;
  __contadorCancelados?: Set<string>;
  __contadorSugerindo?: Set<string>;
};
const downloads = (g.__contadorDownloads ??= new Map());
const cancelados = (g.__contadorCancelados ??= new Set());
const sugerindo = (g.__contadorSugerindo ??= new Set());

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
  const erro = cancelados.delete(jobId) ? "Cancelado pelo usuário." : e instanceof Error ? e.message : String(e);
  atualizarJob(jobId, { status: "erro", erro, mensagem: null });
}

/**
 * Interrompe download ou worker de um job. Os workers são achados pelo
 * caminho do vídeo na linha de comando (funciona mesmo para processos
 * iniciados antes de um hot reload ou de outra instância do módulo).
 */
export function cancelarJob(jobId: string): void {
  cancelados.add(jobId);
  downloads.get(jobId)?.abort();
  spawnSync("pkill", ["-f", `worker/.*${path.join(dirJob(jobId), "video.mp4")}`]);
  // na fila da GPU (ainda sem processo): a tarefa confere o status ao começar
  atualizarJob(jobId, { status: "erro", erro: "Cancelado pelo usuário.", mensagem: null });
}

const JANELA_VELOCIDADE_MS = 5000;

/** 1536 → "1,5 KB" (potências de 1000, como o Drive mostra os tamanhos). */
function formatarBytes(n: number): string {
  const unidades = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1000 && i < unidades.length - 1) {
    n /= 1000;
    i++;
  }
  const casas = i === 0 || n >= 100 ? 0 : 1;
  return `${n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })} ${unidades[i]}`;
}

function formatarDuracao(s: number): string {
  s = Math.ceil(s);
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const min = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${min} min` : `${min} min ${s % 60} s`;
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
      const controle = new AbortController();
      downloads.set(jobId, controle);
      const amostras: [number, number][] = []; // [ms, bytes] dos últimos segundos → velocidade
      const { nome } = await baixarDoDrive(job.drive_id, destino, controle.signal, (feito, total) => {
        const agora = Date.now();
        amostras.push([agora, feito]);
        while (amostras.length > 2 && agora - amostras[0][0] > JANELA_VELOCIDADE_MS) amostras.shift();
        const [t0, b0] = amostras[0];
        const porSeg = agora > t0 ? ((feito - b0) * 1000) / (agora - t0) : 0;
        const partes = [total ? `${formatarBytes(feito)} de ${formatarBytes(total)}` : formatarBytes(feito)];
        if (porSeg > 0) partes.push(`${formatarBytes(porSeg)}/s`);
        if (porSeg > 0 && total) partes.push(`faltam ${formatarDuracao((total - feito) / porSeg)}`);
        atualizarJob(jobId, { progresso: total ? feito / total : 0, mensagem: `Baixando… ${partes.join(" · ")}` });
      });
      downloads.delete(jobId);
      atualizarJob(jobId, { nome_arquivo: nome ?? job.nome_arquivo });
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
  })().catch((e) => {
    downloads.delete(jobId);
    falhar(jobId, e);
  });
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
  contexto?: string;
  clipe: string;
};

const ROTULO_ETAPA: Record<string, string> = {
  detectando: "Detectando e rastreando objetos",
  filmstrips: "Gerando miniaturas",
  clipes: "Gerando clipes",
};

export function temTrilhas(jobId: string): boolean {
  return fs.existsSync(path.join(dirJob(jobId), "trilhas.json.gz"));
}

/**
 * Etapa 2: detecção + candidatos (fila da GPU) → sugerindo. Se as trilhas da
 * detecção já existem (linhas editadas depois), refaz só os candidatos —
 * minutos em vez de repetir a detecção inteira.
 */
export function iniciarDeteccao(jobId: string, linhas: Linha[]): void {
  const dir = dirJob(jobId);
  const soCandidatos = temTrilhas(jobId);
  const arqLinhas = path.join(dir, "linhas.json");
  fs.writeFileSync(arqLinhas, JSON.stringify(linhas));
  fs.rmSync(path.join(dir, "candidatos"), { recursive: true, force: true });
  atualizarJob(jobId, {
    status: "detectando",
    linhas: JSON.stringify(linhas),
    progresso: 0,
    erro: null,
    mensagem: soCandidatos ? "Na fila: refazendo candidatos com as novas linhas…" : "Na fila da GPU…",
  });

  cancelados.delete(jobId);
  void naFilaDaGpu(async () => {
    if (cancelados.has(jobId) || obterJob(jobId)?.status !== "detectando") return;
    const saida = path.join(dir, "candidatos");
    const args = ["--video", path.join(dir, "video.mp4"), "--saida", saida, "--linhas", arqLinhas,
      "--trilhas", path.join(dir, "trilhas.json.gz"), "--etapa", soCandidatos ? "candidatos" : "tudo"];
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
        contexto: c.contexto ? `candidatos/${c.contexto}` : null,
        clipe: `candidatos/${c.clipe}`,
      })),
    );
    atualizarJob(jobId, { status: "sugerindo", progresso: 0, mensagem: `${itens.length} candidatos detectados.` });
    iniciarSugestoes(jobId);
  }).catch((e) => falhar(jobId, e));
}

// ----------------------------------------------------------------------
// Etapa 3: sugestão do OpenRouter para TODO candidato (regra do projeto:
// a revisão humana só começa quando todos têm sugestão).
// ----------------------------------------------------------------------

const CONCORRENCIA_LLM = Number(process.env.OPENROUTER_CONCORRENCIA ?? 6);
const TENTATIVAS_LLM = 4;
// dica do YOLO desligada por padrão: na calibração não melhorou o acerto e
// arrisca puxar o modelo para o erro típico do detector (ciclista noturno
// visto como pedestre). OPENROUTER_DICA_YOLO=1 liga.
const DICA_YOLO = process.env.OPENROUTER_DICA_YOLO === "1";

export function sugestoesAtivas(jobId: string): boolean {
  return sugerindo.has(jobId);
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function iniciarSugestoes(jobId: string): void {
  if (sugerindo.has(jobId)) return;
  sugerindo.add(jobId);
  void (async () => {
    const dir = dirJob(jobId);
    const pendentes = listarCandidatos(jobId).filter((c) => c.status_llm !== "ok");
    for (const c of pendentes) {
      if (c.status_llm === "falhou") {
        registrarSugestao(c.id, {
          sugestao_llm: null, conf_llm: null, justificativa_llm: null,
          modelo_llm: null, custo_llm: null, status_llm: "pendente",
        });
      }
    }
    let abortar: string | null = null;

    const atualizarProgresso = () => {
      const r = resumoSugestoes(jobId);
      atualizarJob(jobId, {
        status: "sugerindo",
        progresso: r.total ? r.ok / r.total : 1,
        mensagem: `Sugerindo classificação… ${r.ok} de ${r.total}${r.falhou ? ` (${r.falhou} falharam)` : ""} · US$ ${r.custo.toFixed(4)}`,
      });
    };
    atualizarProgresso();

    let proximo = 0;
    const trabalhador = async () => {
      while (!abortar && proximo < pendentes.length) {
        const c = pendentes[proximo++];
        for (let tentativa = 1; ; tentativa++) {
          try {
            const r = await sugerirCategoria({
              filmstrip: path.join(dir, c.filmstrip ?? ""),
              contexto: c.contexto ? path.join(dir, c.contexto) : null,
              dicaDetector: DICA_YOLO ? c.classe_yolo : null,
            });
            registrarSugestao(c.id, {
              sugestao_llm: r.categoria,
              conf_llm: r.confianca,
              justificativa_llm: r.justificativa,
              modelo_llm: r.modelo,
              custo_llm: r.custo_usd,
              status_llm: "ok",
            });
            break;
          } catch (e) {
            const erro = e instanceof ErroOpenRouter ? e : new ErroOpenRouter(String(e), null, false);
            // chave inválida / sem créditos: não adianta continuar o lote
            if (erro.status === 401 || erro.status === 402 || erro.status === 403) {
              abortar = erro.message;
              break;
            }
            if (!erro.transitorio || tentativa >= TENTATIVAS_LLM) {
              registrarSugestao(c.id, {
                sugestao_llm: null, conf_llm: null, justificativa_llm: erro.message,
                modelo_llm: null, custo_llm: null, status_llm: "falhou",
              });
              break;
            }
            await esperar(1000 * 2 ** tentativa);
          }
        }
        atualizarProgresso();
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, CONCORRENCIA_LLM) }, trabalhador));

    const r = resumoSugestoes(jobId);
    if (abortar) {
      atualizarJob(jobId, { status: "erro", erro: `Sugestões interrompidas: ${abortar}`, mensagem: null });
    } else if (r.falhou > 0 || r.ok < r.total) {
      atualizarJob(jobId, {
        mensagem: `${r.ok} de ${r.total} com sugestão; ${r.total - r.ok} falharam — use "Retomar sugestões".`,
      });
    } else {
      atualizarJob(jobId, {
        status: "aguardando_revisao",
        progresso: 1,
        mensagem: `${r.total} candidatos com sugestão · custo US$ ${r.custo.toFixed(4)}`,
      });
    }
  })()
    .catch((e) => falhar(jobId, e))
    .finally(() => sugerindo.delete(jobId));
}

// ----------------------------------------------------------------------
// Vídeo final: um ou mais jobs revisados num único vídeo, contador somando
// entre eles. O plano congela as decisões humanas do momento do pedido.
// ----------------------------------------------------------------------

export function iniciarRender(renderId: string): void {
  const render = obterRender(renderId);
  if (!render) return;
  const dir = dirRender(renderId);
  fs.mkdirSync(dir, { recursive: true });
  const videos = (JSON.parse(render.jobs) as string[]).map((jobId) => {
    const job = obterJob(jobId);
    if (!job) throw new Error(`Job ${jobId} não existe mais.`);
    const djob = dirJob(jobId);
    return {
      job: jobId,
      titulo: job.nome_arquivo ?? jobId,
      video: path.join(djob, job.arquivo_video ?? "video.mp4"),
      trilhas: path.join(djob, "trilhas.json.gz"),
      linhas: JSON.parse(job.linhas) as Linha[],
      eventos: listarCandidatos(jobId)
        .filter((c) => c.rotulo && c.rotulo !== "descartado")
        .map((c) => ({ id: c.id, frame: c.frame, linha_id: c.linha_id, categoria: c.rotulo, direcao: c.direcao, track: c.track })),
    };
  });
  const arqPlano = path.join(dir, "plano.json");
  fs.writeFileSync(arqPlano, JSON.stringify({ videos }, null, 1));
  for (const f of ["video_final.mp4", "relatorio.json", "eventos.csv"]) fs.rmSync(path.join(dir, f), { force: true });
  atualizarRender(renderId, { status: "na_fila", progresso: 0, erro: null, mensagem: "Na fila da GPU…" });

  cancelados.delete(renderId);
  void naFilaDaGpu(async () => {
    if (cancelados.has(renderId) || obterRender(renderId)?.status !== "na_fila") return;
    atualizarRender(renderId, { status: "renderizando", mensagem: "Começando…" });
    const args = ["--plano", arqPlano, "--saida", dir];
    if (process.env.CONTADOR_FIM_S) args.push("--fim", process.env.CONTADOR_FIM_S); // testes rápidos
    let fim: EventoWorker | null = null;
    await rodarWorker("renderizar.py", args, (ev) => {
      if (ev.tipo === "fim") fim = ev;
      if (ev.tipo !== "progresso") return;
      const qual = ev.videos && ev.videos > 1 ? ` vídeo ${ev.video} de ${ev.videos}` : "";
      atualizarRender(renderId, { progresso: ev.p, mensagem: `Gerando${qual}…${ev.fps ? ` (${ev.fps} fps)` : ""}` });
    });
    const f = fim as Extract<EventoWorker, { tipo: "fim" }> | null;
    atualizarRender(renderId, {
      status: "pronto",
      progresso: 1,
      mensagem: f ? `${f.eventos} contagens · ${Math.round((f.duracao_s ?? 0) / 60)} min de vídeo` : null,
    });
  }).catch((e) => {
    const erro = cancelados.delete(renderId) ? "Cancelado pelo usuário." : e instanceof Error ? e.message : String(e);
    atualizarRender(renderId, { status: "erro", erro, mensagem: null });
  });
}

export function cancelarRender(renderId: string): void {
  cancelados.add(renderId);
  spawnSync("pkill", ["-f", `worker/renderizar.py --plano ${path.join(dirRender(renderId), "plano.json")}`]);
  atualizarRender(renderId, { status: "erro", erro: "Cancelado pelo usuário.", mensagem: null });
}
