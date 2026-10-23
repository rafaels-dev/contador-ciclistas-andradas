import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
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

/** Python que roda o worker: PYTHON, senão o ambiente do app, senão o do sistema. */
export function pythonDoMotor(): string {
  if (process.env.PYTHON) return process.env.PYTHON;
  const pasta = pastaMotor();
  if (pasta && fs.existsSync(pythonDaPasta(pasta))) return pythonDaPasta(pasta);
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
    const proc = spawn(/* turbopackIgnore: true */ python, ["-c", SONDA], { cwd: RAIZ_REPO, windowsHide: true });
    const limite = setTimeout(() => proc.kill(), 60_000);
    proc.stdout.on("data", (d) => (saida += d));
    proc.stderr.on("data", (d) => (erro = (erro + d).slice(-2000)));
    proc.on("error", () => {
      clearTimeout(limite);
      resolve({ python, ok: false, erro: "Python não encontrado." });
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

export type Instalacao = { rodando: boolean; linhas: string[]; ok: boolean | null };

const g = globalThis as { __contadorInstalacao?: Instalacao };

export function estadoInstalacao(): Instalacao {
  return g.__contadorInstalacao ?? { rodando: false, linhas: [], ok: null };
}

/** uv: o empacotado no app (CONTADOR_UV) ou o do PATH. */
function uv(): string {
  return process.env.CONTADOR_UV || "uv";
}

function temNvidia(): boolean {
  if (process.platform === "darwin") return false;
  return spawnSync("nvidia-smi", ["-L"], { windowsHide: true }).status === 0;
}

function passo(args: string[], estado: Instalacao): Promise<void> {
  return new Promise((resolve, reject) => {
    estado.linhas.push(`$ uv ${args.join(" ")}`);
    const proc = spawn(/* turbopackIgnore: true */ uv(), args, { cwd: RAIZ_REPO, windowsHide: true, env: { ...process.env, UV_NO_PROGRESS: "1" } });
    const linha = (d: Buffer) => {
      for (const l of String(d).split(/\r?\n/)) if (l.trim()) estado.linhas.push(l.slice(0, 300));
      if (estado.linhas.length > 400) estado.linhas.splice(0, estado.linhas.length - 400);
    };
    proc.stdout.on("data", linha);
    proc.stderr.on("data", linha);
    proc.on("error", (e) => reject(new Error(`uv não encontrado (${e.message}).`)));
    proc.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`uv saiu com código ${c}.`))));
  });
}

/**
 * Cria (ou completa) o ambiente do motor: Python 3.11, PyTorch com CUDA se
 * houver placa NVIDIA (senão CPU; no Mac, a versão com MPS) e o
 * requirements.txt. Leva alguns minutos e uns 3 GB na primeira vez.
 */
export function instalarMotor(): void {
  const pasta = pastaMotor();
  if (!pasta || estadoInstalacao().rodando) return;
  const estado: Instalacao = { rodando: true, linhas: [], ok: null };
  g.__contadorInstalacao = estado;
  const python = pythonDaPasta(pasta);
  void (async () => {
    if (!fs.existsSync(python)) await passo(["venv", "--python", "3.11", pasta], estado);
    const nvidia = temNvidia();
    estado.linhas.push(nvidia ? "Placa NVIDIA encontrada: PyTorch com CUDA." : "Sem placa NVIDIA: PyTorch para CPU.");
    const indice = process.platform === "darwin" ? [] : ["--index-url", `https://download.pytorch.org/whl/${nvidia ? "cu124" : "cpu"}`];
    await passo(["pip", "install", "--python", python, "torch", "torchvision", ...indice], estado);
    await passo(["pip", "install", "--python", python, "-r", path.join(RAIZ_REPO, "requirements.txt")], estado);
  })()
    .then(() => {
      estado.ok = true;
      estado.linhas.push("Motor pronto.");
    })
    .catch((e) => {
      estado.ok = false;
      estado.linhas.push(`Falhou: ${(e as Error).message}`);
    })
    .finally(() => (estado.rodando = false));
}
