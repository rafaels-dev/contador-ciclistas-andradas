import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { lerConfiguracao } from "./db";
import { RAIZ_REPO } from "./paths";

/**
 * O "motor" é o Python que roda worker/ (YOLO, ffmpeg, OpenCV). No
 * desenvolvimento é o Python do sistema; no app desktop, um ambiente próprio
 * em CONTADOR_MOTOR (pasta de dados do app), criado pela tela de
 * Configurações com o uv — como o instalador do Spotify, o app baixa o que
 * falta na primeira execução em vez de trazer 3 GB de PyTorch no instalador.
 */

const WIN = process.platform === "win32";

/** Pasta do ambiente Python próprio do app (só no desktop). */
export function pastaMotor(): string | null {
  return process.env.CONTADOR_MOTOR || null;
}

function pythonDaPasta(pasta: string): string {
  return WIN ? path.join(pasta, "Scripts", "python.exe") : path.join(pasta, "bin", "python");
}

/**
 * Python que roda o worker: PYTHON, senão o ambiente do app (no desktop —
 * nunca um Python qualquer do sistema, que muda sem o app saber), senão o do
 * sistema (desenvolvimento).
 */
export function pythonDoMotor(): string {
  if (process.env.PYTHON) return process.env.PYTHON;
  const pasta = pastaMotor();
  if (pasta) return pythonDaPasta(pasta);
  return WIN ? "python" : "python3";
}

export type StatusMotor = {
  python: string;
  ok: boolean;
  versao?: string;
  faltando?: string[];
  gpu?: string | null;
  erro?: string;
};

const SONDA = `
import importlib, json, sys
r = {"versao": sys.version.split()[0], "faltando": [], "gpu": None}
for m in ("ultralytics", "supervision", "cv2", "numpy", "PIL", "imageio_ffmpeg"):
    try:
        importlib.import_module(m)
    except Exception:
        r["faltando"].append(m)
try:
    import torch
    if torch.cuda.is_available():
        r["gpu"] = torch.cuda.get_device_name(0)
    elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        r["gpu"] = "Apple (MPS)"
except Exception:
    r["faltando"].append("torch")
print(json.dumps(r))
`;

export function statusMotor(): Promise<StatusMotor> {
  const python = pythonDoMotor();
  return new Promise((resolve) => {
    let saida = "";
    let erro = "";
    const proc = spawn(/* turbopackIgnore: true */ python, ["-c", SONDA], { cwd: RAIZ_REPO, windowsHide: true, env: { ...process.env, PYTHONUTF8: "1" } });
    const limite = setTimeout(() => proc.kill(), 60_000);
    proc.stdout.on("data", (d) => (saida += d));
    proc.stderr.on("data", (d) => (erro = (erro + d).slice(-2000)));
    proc.on("error", () => {
      clearTimeout(limite);
      resolve({ python, ok: false, erro: "Python não encontrado (motor ainda não instalado)." });
    });
    proc.on("close", () => {
      clearTimeout(limite);
      try {
        const r = JSON.parse(saida.trim().split("\n").pop() ?? "") as { versao: string; faltando: string[]; gpu: string | null };
        resolve({ python, ok: r.faltando.length === 0, ...r });
      } catch {
        resolve({ python, ok: false, erro: erro.trim().split("\n").pop() || "O Python não respondeu." });
      }
    });
  });
}

export type Instalacao = {
  rodando: boolean;
  ok: boolean | null;
  /** passo atual (1–3) e o que ele faz, em linguagem simples */
  passo: number;
  etapa: string;
  /** saída do uv, para "detalhes" */
  linhas: string[];
};

export const PASSOS_INSTALACAO = 3;

const g = globalThis as { __contadorInstalacao?: Instalacao };

export function estadoInstalacao(): Instalacao {
  return g.__contadorInstalacao ?? { rodando: false, ok: null, passo: 0, etapa: "", linhas: [] };
}

/** uv: o empacotado no app (CONTADOR_UV) ou o do PATH. */
function uv(): string {
  return process.env.CONTADOR_UV || "uv";
}

export type Placa = { tipo: "nvidia" | "apple" | null; nome: string | null };

/** Placa de vídeo que acelera a detecção: NVIDIA (CUDA) ou chip Apple (MPS). */
export function detectarPlaca(): Placa {
  if (process.platform === "darwin") return process.arch === "arm64" ? { tipo: "apple", nome: "Chip Apple" } : { tipo: null, nome: null };
  const r = spawnSync("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  const nome = r.status === 0 ? r.stdout.split(/\r?\n/)[0]?.trim() : "";
  return nome ? { tipo: "nvidia", nome } : { tipo: null, nome: null };
}

/** Preferência do usuário: usar a placa de vídeo (padrão, se houver) ou só o processador. */
export function usarPlaca(): boolean {
  return lerConfiguracao("placa") !== "cpu";
}

/** Variáveis para o worker: com "só o processador", esconde a placa do PyTorch e do ffmpeg. */
export function ambienteDoWorker(): Record<string, string> {
  return usarPlaca() ? {} : { CUDA_VISIBLE_DEVICES: "", CONTADOR_SEM_NVDEC: "1" };
}

function rodarUv(args: string[], estado: Instalacao): Promise<void> {
  return new Promise((resolve, reject) => {
    estado.linhas.push(`$ uv ${args.join(" ")}`);
    const proc = spawn(/* turbopackIgnore: true */ uv(), args, { cwd: RAIZ_REPO, windowsHide: true, env: { ...process.env, UV_NO_PROGRESS: "1" } });
    const linha = (d: Buffer) => {
      for (const l of String(d).split(/\r?\n/)) if (l.trim()) estado.linhas.push(l.slice(0, 300));
      if (estado.linhas.length > 400) estado.linhas.splice(0, estado.linhas.length - 400);
    };
    proc.stdout.on("data", linha);
    proc.stderr.on("data", linha);
    proc.on("error", (e) => reject(new Error(`o instalador (uv) não foi encontrado: ${e.message}`)));
    proc.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`o instalador parou com erro (código ${c}). Confira a internet e tente de novo.`))));
  });
}

/**
 * Cria (ou completa) o ambiente do motor: Python 3.11, PyTorch (com CUDA se
 * houver placa NVIDIA e o usuário quiser usá-la; senão para processador; no
 * Mac, a versão com MPS) e o requirements.txt. Leva alguns minutos e uns
 * 3 GB na primeira vez.
 */
export function instalarMotor(): void {
  const pasta = pastaMotor();
  if (!pasta || estadoInstalacao().rodando) return;
  const estado: Instalacao = { rodando: true, ok: null, passo: 1, etapa: "Baixando o Python", linhas: [] };
  g.__contadorInstalacao = estado;
  const python = pythonDaPasta(pasta);
  void (async () => {
    if (!fs.existsSync(python)) await rodarUv(["venv", "--python", "3.11", pasta], estado);
    const cuda = detectarPlaca().tipo === "nvidia" && usarPlaca();
    Object.assign(estado, { passo: 2, etapa: cuda ? "Baixando a inteligência artificial com suporte à placa de vídeo (≈2,5 GB)" : "Baixando a inteligência artificial (≈1 GB)" });
    // cu126: roda nos drivers NVIDIA dos últimos anos; versões iguais às do desenvolvimento
    const indice = process.platform === "darwin" ? [] : ["--index-url", `https://download.pytorch.org/whl/${cuda ? "cu126" : "cpu"}`];
    await rodarUv(["pip", "install", "--python", python, "torch==2.12.0", "torchvision==0.27.0", ...indice], estado);
    Object.assign(estado, { passo: 3, etapa: "Instalando o detector de objetos" });
    await rodarUv(["pip", "install", "--python", python, "-r", path.join(RAIZ_REPO, "requirements.txt")], estado);
  })()
    .then(() => Object.assign(estado, { ok: true, etapa: "Pronto" }))
    .catch((e) => Object.assign(estado, { ok: false, etapa: `Não deu certo: ${(e as Error).message}` }))
    .finally(() => (estado.rodando = false));
}
