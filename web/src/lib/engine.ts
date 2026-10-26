import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { msg } from "@/i18n/message";
import { readSetting } from "./db";
import { REPO_ROOT } from "./paths";

/**
 * The "engine" is the Python that runs worker/ (YOLO, ffmpeg, OpenCV). In
 * development it is the system Python; in the desktop app, its own
 * environment in TRAFFIC_COUNTER_ENGINE (app data folder), created from the
 * Settings screen with uv — like the Spotify installer, the app downloads
 * what is missing on the first run instead of shipping 3 GB of PyTorch in
 * the installer.
 */

const WIN = process.platform === "win32";

/** Folder of the app's own Python environment (desktop only). */
export function engineDir(): string | null {
  return process.env.TRAFFIC_COUNTER_ENGINE || null;
}

function pythonIn(dir: string): string {
  return WIN ? path.join(dir, "Scripts", "python.exe") : path.join(dir, "bin", "python");
}

/**
 * Python that runs the worker: PYTHON, otherwise the app environment (on the
 * desktop — never some system Python, which changes without the app knowing),
 * otherwise the system one (development).
 */
export function enginePython(): string {
  if (process.env.PYTHON) return process.env.PYTHON;
  const dir = engineDir();
  if (dir) return pythonIn(dir);
  return WIN ? "python" : "python3";
}

export type EngineStatus = {
  python: string;
  ok: boolean;
  version?: string;
  missing?: string[];
  gpu?: string | null;
  /** translatable message (lib/i18n/message.ts) or plain text from Python */
  error?: string;
};

const PROBE = `
import importlib, json, sys
r = {"version": sys.version.split()[0], "missing": [], "gpu": None}
for m in ("ultralytics", "supervision", "cv2", "numpy", "PIL", "imageio_ffmpeg"):
    try:
        importlib.import_module(m)
    except Exception:
        r["missing"].append(m)
try:
    import torch
    if torch.cuda.is_available():
        r["gpu"] = torch.cuda.get_device_name(0)
    elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        r["gpu"] = "Apple (MPS)"
except Exception:
    r["missing"].append("torch")
print(json.dumps(r))
`;

export async function engineStatus(): Promise<EngineStatus> {
  await adjustEngine();
  const python = enginePython();
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    const proc = spawn(/* turbopackIgnore: true */ python, ["-c", PROBE], { cwd: REPO_ROOT, windowsHide: true, env: { ...process.env, PYTHONUTF8: "1" } });
    const limit = setTimeout(() => proc.kill(), 60_000);
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
    proc.on("error", () => {
      clearTimeout(limit);
      resolve({ python, ok: false, error: msg("engine.pythonNotFound") });
    });
    proc.on("close", () => {
      clearTimeout(limit);
      try {
        const r = JSON.parse(out.trim().split("\n").pop() ?? "") as { version: string; missing: string[]; gpu: string | null };
        resolve({ python, ok: r.missing.length === 0, ...r });
      } catch {
        resolve({ python, ok: false, error: err.trim().split("\n").pop() || msg("engine.pythonSilent") });
      }
    });
  });
}

export type Installation = {
  running: boolean;
  ok: boolean | null;
  /** current step (1–3; 0 = a quick fix of an installed engine) and what it does — a translatable message */
  step: number;
  stage: string;
  /** uv output, for "details" */
  lines: string[];
};

export { INSTALL_STEPS } from "./install-steps";

const g = globalThis as { __tcInstallation?: Installation; __tcEngineAdjust?: Promise<void> };

export function installState(): Installation {
  return g.__tcInstallation ?? { running: false, ok: null, step: 0, stage: "", lines: [] };
}

/** uv: the one bundled with the app (TRAFFIC_COUNTER_UV) or the one on the PATH. */
function uv(): string {
  return process.env.TRAFFIC_COUNTER_UV || "uv";
}

export type Gpu = { kind: "nvidia" | "apple" | null; name: string | null };

/** GPU that speeds up detection: NVIDIA (CUDA) or Apple chip (MPS). */
export function detectGpu(): Gpu {
  if (process.platform === "darwin") return process.arch === "arm64" ? { kind: "apple", name: "Apple silicon" } : { kind: null, name: null };
  const r = spawnSync("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  const name = r.status === 0 ? r.stdout.split(/\r?\n/)[0]?.trim() : "";
  return name ? { kind: "nvidia", name } : { kind: null, name: null };
}

/** User preference: use the GPU (default, if there is one) or the processor only. */
export function gpuPreferred(): boolean {
  return readSetting("gpu") !== "cpu";
}

/** Variables for the worker: with "processor only", hides the GPU from PyTorch and ffmpeg. */
export function workerEnv(): Record<string, string> {
  return gpuPreferred() ? {} : { CUDA_VISIBLE_DEVICES: "", TRAFFIC_COUNTER_NO_NVDEC: "1" };
}

function runUv(args: string[], state: Installation): Promise<void> {
  return new Promise((resolve, reject) => {
    state.lines.push(`$ uv ${args.join(" ")}`);
    const proc = spawn(/* turbopackIgnore: true */ uv(), args, { cwd: REPO_ROOT, windowsHide: true, env: { ...process.env, UV_NO_PROGRESS: "1" } });
    const line = (d: Buffer) => {
      for (const l of String(d).split(/\r?\n/)) if (l.trim()) state.lines.push(l.slice(0, 300));
      if (state.lines.length > 400) state.lines.splice(0, state.lines.length - 400);
    };
    proc.stdout.on("data", line);
    proc.stderr.on("data", line);
    proc.on("error", (e) => reject(new Error(msg("engine.uvMissing", { detail: e.message }))));
    proc.on("close", (c) => (c === 0 ? resolve() : reject(new Error(msg("engine.uvFailed", { code: String(c) })))));
  });
}

function runUvOutput(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = "";
    let err = "";
    const proc = spawn(/* turbopackIgnore: true */ uv(), args, { cwd: REPO_ROOT, windowsHide: true, env: { ...process.env, UV_NO_PROGRESS: "1" } });
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
    proc.on("error", reject);
    proc.on("close", (c) => (c === 0 ? resolve(out) : reject(new Error(err.trim().split("\n").pop() || `uv exited with code ${c}`))));
  });
}

/** Version of a package pinned in requirements.txt. */
function pinnedVersion(pkg: string): string | null {
  try {
    const req = fs.readFileSync(path.join(REPO_ROOT, "requirements.txt"), "utf8");
    return new RegExp(`^${pkg}==(\\S+)`, "m").exec(req)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Up to 0.0.6 the engine had two OpenCV builds in the same cv2 folder: the
 * opencv-python-headless from requirements.txt and the opencv-python that
 * ultralytics pulls (another version). uv installs in parallel and cv2 ended
 * up broken or not depending on the order. Keeps only the pinned
 * opencv-python. The package is downloaded BEFORE touching the engine (into
 * uv's cache): without internet nothing changes and it tries again next time.
 */
export async function fixOpenCV(python: string, state: Installation | null): Promise<boolean> {
  const version = pinnedVersion("opencv-python");
  if (!version) return false;
  const packages = JSON.parse(await runUvOutput(["pip", "list", "--python", python, "--format", "json"])) as { name: string; version: string }[];
  const cv = packages.filter((p) => p.name.startsWith("opencv-"));
  if (cv.length === 1 && cv[0].name === "opencv-python" && cv[0].version === version) return false;

  if (state) Object.assign(state, { stage: msg("engine.fixingOpenCV") });
  const target = `opencv-python==${version}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "traffic-counter-opencv-"));
  try {
    await runUvOutput(["pip", "install", "--python", python, "--no-deps", "--target", tmp, target]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  await runUvOutput(["pip", "uninstall", "--python", python, ...cv.map((p) => p.name)]);
  await runUvOutput(["pip", "install", "--python", python, "--no-deps", "--offline", target]);
  return true;
}

/**
 * Fixes on engines installed by older app versions. Once per run, before the
 * first worker (the runner waits); shows in "Tasks in progress" while it
 * runs. If it fails, carries on with the engine as it is.
 */
export function adjustEngine(): Promise<void> {
  const dir = engineDir();
  if (!dir || !fs.existsSync(pythonIn(dir))) return Promise.resolve();
  g.__tcEngineAdjust ??= (async () => {
    if (installState().running) return; // the installation fixes it at the end
    const state: Installation = { running: true, ok: null, step: 0, stage: msg("engine.checking"), lines: [] };
    g.__tcInstallation = state;
    try {
      if (await fixOpenCV(pythonIn(dir), state)) console.log("[engine] OpenCV fixed (there was more than one copy)");
      Object.assign(state, { ok: true, stage: msg("engine.ready") });
    } catch (e) {
      console.error(`[engine] could not fix OpenCV: ${(e as Error).message}`);
      g.__tcEngineAdjust = undefined; // try again on the next worker
      Object.assign(state, { ok: null, stage: "" });
    } finally {
      state.running = false;
    }
  })();
  return g.__tcEngineAdjust;
}

/**
 * Creates (or completes) the engine environment: Python 3.11, PyTorch (with
 * CUDA if there is an NVIDIA GPU and the user wants to use it; otherwise for
 * the processor; on the Mac, the MPS build) and requirements.txt. Takes a
 * few minutes and about 3 GB the first time.
 */
export function installEngine(): void {
  const dir = engineDir();
  if (!dir || installState().running) return;
  const state: Installation = { running: true, ok: null, step: 1, stage: msg("engine.downloadingPython"), lines: [] };
  g.__tcInstallation = state;
  const python = pythonIn(dir);
  void (async () => {
    if (!fs.existsSync(python)) await runUv(["venv", "--python", "3.11", dir], state);
    const cuda = detectGpu().kind === "nvidia" && gpuPreferred();
    Object.assign(state, { step: 2, stage: msg(cuda ? "engine.downloadingAiGpu" : "engine.downloadingAi") });
    // cu126: runs on NVIDIA drivers from recent years; same versions as development
    const index = process.platform === "darwin" ? [] : ["--index-url", `https://download.pytorch.org/whl/${cuda ? "cu126" : "cpu"}`];
    await runUv(["pip", "install", "--python", python, "torch==2.12.0", "torchvision==0.27.0", ...index], state);
    Object.assign(state, { step: 3, stage: msg("engine.installingDetector") });
    await runUv(["pip", "install", "--python", python, "-r", path.join(REPO_ROOT, "requirements.txt")], state);
    await fixOpenCV(python, state);
  })()
    .then(() => Object.assign(state, { ok: true, stage: msg("engine.ready") }))
    .catch((e) => Object.assign(state, { ok: false, stage: msg("engine.failed", { detail: (e as Error).message }) }))
    .finally(() => (state.running = false));
}
