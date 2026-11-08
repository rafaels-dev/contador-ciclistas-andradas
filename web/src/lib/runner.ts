import "./env";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os, { EOL } from "node:os";
import readline from "node:readline";
import type { Locale } from "@/i18n/locales";
import { msg } from "@/i18n/message";
import { appLocale, translatorFor } from "@/i18n/server";
import {
  CATEGORIES,
  deleteJob,
  getJob,
  getRender,
  jobDir,
  jobFile,
  jobTempDir,
  listCandidates,
  recordSuggestion,
  renderDir,
  replaceCandidates,
  updateCandidateMedia,
  suggestionSummary,
  updateJob,
  updateRender,
  type Area,
  type Candidate,
  type Category,
  type Line,
} from "./db";
import { downloadFromDrive } from "./drive";
import { adjustEngine, enginePython, workerEnv } from "./engine";
import { escapeRegExp } from "./fsutil";
import { moveFinished } from "./move-state";
import { OpenRouterError, suggestCategory, suggestionModels } from "./openrouter";
import { movedVideo } from "./legacy";
import { parseHighlights } from "./highlights";
import { REPO_ROOT } from "./paths";
import { NO_CONSULTATION, countsOnLine } from "./review";

/**
 * Orchestrates a job's heavy steps outside the request cycle: download
 * (Node) and the Python scripts in worker/ (GPU). Detections run in a single
 * queue — an 8 GB GPU cannot comfortably take two videos in parallel.
 *
 * Texts written to jobs.message / jobs.error are translatable messages
 * (i18n/message.ts): the screen shows them in the current app language.
 */

type WorkerEvent =
  | { type: "progress"; stage: string; p: number; fps?: number; candidates?: number; video?: number; videos?: number }
  | { type: "info"; fps: number; frames: number; width: number; height: number; duration_s: number }
  | { type: "done"; candidates?: number; events?: number; duration_s?: number; codec?: string }
  | { type: "error"; message: string; code?: string };

/** Worker error codes → message keys. */
const WORKER_ERRORS: Record<string, string> = {
  video_unreadable: "errors.videoUnreadable",
  video_no_frames: "errors.videoNoFrames",
};

const g = globalThis as {
  __tcGpuQueue?: Promise<unknown>;
  __tcDownloads?: Map<string, AbortController>;
  __tcCancelled?: Set<string>;
  __tcSuggesting?: Set<string>;
  __tcRebuilding?: Map<string, number>;
  __tcRebuildFailures?: Map<string, "wrongVideo" | "failed">;
  __tcProcesses?: Map<string, Set<ChildProcess>>;
  __tcExitHook?: boolean;
};
const downloads = (g.__tcDownloads ??= new Map());
const cancelled = (g.__tcCancelled ??= new Set());
const suggesting = (g.__tcSuggesting ??= new Set());
// worker processes per job/render, to cancel without relying on pkill
const processes = (g.__tcProcesses ??= new Map());

// desktop app: closing the window ends the server — the workers (Python,
// ffmpeg) must not be left orphaned running on the GPU
if (!g.__tcExitHook) {
  g.__tcExitHook = true;
  const killAll = () => {
    for (const owner of processes.keys()) killProcesses(owner);
  };
  process.on("exit", killAll);
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      killAll();
      process.exit(0);
    });
  }
}

/** Kills the workers of a job/render, children (ffmpeg) included. */
function killProcesses(owner: string): void {
  for (const proc of processes.get(owner) ?? []) {
    if (proc.exitCode !== null || !proc.pid) continue;
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true });
    else proc.kill("SIGTERM");
  }
}

function onGpuQueue<T>(task: () => Promise<T>): Promise<T> {
  const previous = g.__tcGpuQueue ?? Promise.resolve();
  // a folder move in progress (lib/move.ts) first: the task would write into a folder being copied and deleted
  const next = previous.catch(() => undefined).then(moveFinished).then(task);
  g.__tcGpuQueue = next;
  return next;
}

async function runWorker(script: string, args: string[], onEvent: (e: WorkerEvent) => void, owner?: string): Promise<void> {
  await adjustEngine();
  return new Promise((resolve, reject) => {
    const proc = spawn(enginePython(), [path.join("worker", script), ...args], {
      cwd: REPO_ROOT,
      // PYTHONUTF8: on Windows Python uses cp1252 on stdout and on open()
      // without an encoding — the JSON of the events ("A→B", "…") crashed the worker
      env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONUTF8: "1", ...workerEnv() },
      windowsHide: true,
    });
    if (owner) {
      const own = processes.get(owner) ?? new Set<ChildProcess>();
      processes.set(owner, own.add(proc));
      proc.on("close", () => {
        own.delete(proc);
        if (!own.size) processes.delete(owner);
      });
    }
    let workerError: string | null = null;
    let stderr = "";
    readline.createInterface({ input: proc.stdout }).on("line", (line) => {
      let ev: WorkerEvent;
      try {
        ev = JSON.parse(line);
      } catch {
        return; // stray output from libraries
      }
      if (ev.type === "error") workerError = ev.code && WORKER_ERRORS[ev.code] ? msg(WORKER_ERRORS[ev.code]) : ev.message;
      onEvent(ev);
    });
    proc.stderr.on("data", (d) => {
      stderr = (stderr + d).slice(-4000);
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(workerError ?? `worker/${script} exited with code ${code}: ${stderr.trim().split("\n").pop()}`));
    });
  });
}

function fail(jobId: string, e: unknown): void {
  const error = cancelled.delete(jobId) ? msg("errors.cancelled") : e instanceof Error ? e.message : String(e);
  updateJob(jobId, { status: "error", error, message: null });
}

/**
 * Stops a job's download or worker. Workers are found through the job folder
 * on the command line (works even for processes started before a hot reload
 * or by another instance of the module).
 */
export function cancelJob(jobId: string): void {
  cancelled.add(jobId);
  downloads.get(jobId)?.abort();
  killProcesses(jobId);
  // processes from before a `next dev` hot reload (not in the map)
  if (process.platform !== "win32") spawnSync("pkill", ["-f", `worker/.*${escapeRegExp(jobDir(jobId))}(/| |$)`]);
  // in the GPU queue (no process yet): the task checks the status when it starts
  updateJob(jobId, { status: "error", error: msg("errors.cancelled"), message: null });
}

/**
 * Removes videos from the library: stops what is running, deletes the
 * database rows and the job folder (downloaded video, detection, media). A
 * video from the computer is used in place and stays where it is. Final
 * videos already generated keep their files.
 */
export function deleteJobs(ids: string[]): void {
  for (const id of ids) {
    if (!getJob(id)) continue;
    const dirs = [...new Set([jobDir(id), jobTempDir(id)])]; // the temporary one is recorded in the row that goes away
    cancelJob(id);
    deleteJob(id); // a suggestion batch in progress sees the job is gone and stops
    // Windows: a worker just killed may still hold files for a moment
    for (const dir of dirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
      } catch (e) {
        console.error(`[delete] ${dir}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
}

const SPEED_WINDOW_MS = 5000;

/** 1536 → "1.5 KB" (powers of 1000, as Drive shows sizes), in the app language. */
function formatBytes(n: number, locale: Locale): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  const digits = i === 0 || n >= 100 ? 0 : 1;
  return `${n.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${units[i]}`;
}

function formatDuration(s: number): string {
  s = Math.ceil(s);
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const min = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${min} min` : `${min} min ${s % 60} s`;
}

/**
 * Progress message of a transfer ("417 MB of 3.7 GB · 64.4 MB/s · 52 s
 * left"); the speed is the average of the last SPEED_WINDOW_MS.
 */
function transferMeter(locale: Locale): (done: number, total: number | null) => string {
  const samples: [number, number][] = []; // [ms, bytes]
  return (done, total) => {
    const now = Date.now();
    samples.push([now, done]);
    while (samples.length > 2 && now - samples[0][0] > SPEED_WINDOW_MS) samples.shift();
    const [t0, b0] = samples[0];
    const perSecond = now > t0 ? ((done - b0) * 1000) / (now - t0) : 0;
    return msg("runner.downloadProgress", {
      done: formatBytes(done, locale),
      total: total ? formatBytes(total, locale) : "none",
      speed: perSecond > 0 ? formatBytes(perSecond, locale) : "none",
      eta: perSecond > 0 && total ? formatDuration((total - done) / perSecond) : "none",
    });
  };
}

/** Step 1: download + metadata + first frame → awaiting_lines. */
export function startDownload(jobId: string): void {
  void (async () => {
    await moveFinished();
    const job = getJob(jobId);
    if (!job) return;
    const dir = jobDir(jobId);
    fs.mkdirSync(dir, { recursive: true });
    // the copy from the Drive can be downloaded again: temporary folder
    fs.mkdirSync(jobTempDir(jobId), { recursive: true });
    const target = path.join(jobTempDir(jobId), "video.mp4");

    if (job.drive_id === "local") {
      // video from the computer itself: used in place, no copy
      if (!fs.existsSync(job.drive_link)) throw new Error(msg("errors.fileNotFound", { path: job.drive_link }));
      updateJob(jobId, { status: "downloading", progress: 0, error: null, video_file: job.drive_link });
    } else {
      updateJob(jobId, { status: "downloading", progress: 0, error: null, message: msg("runner.downloading") });
      const control = new AbortController();
      downloads.set(jobId, control);
      const meter = transferMeter(appLocale());
      const { name } = await downloadFromDrive(job.drive_id, target, control.signal, (done, total) => {
        updateJob(jobId, { progress: total ? done / total : 0, message: meter(done, total) });
      });
      downloads.delete(jobId);
      updateJob(jobId, { file_name: name ?? job.file_name });
    }
    await readVideo(jobId);
  })().catch((e) => {
    downloads.delete(jobId);
    fail(jobId, e);
  });
}

/** The job's video: the original local file (absolute path) or the one downloaded into the job folder. */
export function videoPath(jobId: string): string {
  const file = getJob(jobId)?.video_file ?? "video.mp4";
  // movedVideo: a video used in place from the repository's old avaliacao/ folder
  return path.isAbsolute(file) ? (movedVideo(file) as string) : jobFile(jobId, file);
}

/** Metadata + first frame of the video already on disk → awaiting_lines. */
async function readVideo(jobId: string): Promise<void> {
  const dir = jobDir(jobId);
  updateJob(jobId, { message: msg("runner.readingVideo"), progress: 1 });
  const job = getJob(jobId);
  if (!job?.video_file) updateJob(jobId, { video_file: "video.mp4" });
  await runWorker("info.py", [videoPath(jobId), dir], (ev) => {
    if (ev.type === "info") {
      updateJob(jobId, {
        fps: ev.fps,
        width: ev.width,
        height: ev.height,
        duration_s: ev.duration_s,
      });
    }
  }, jobId);
  updateJob(jobId, { status: "awaiting_lines", message: null, progress: 0 });
}

type WorkerCandidate = {
  id: number;
  track: string;
  line_id: string | null;
  frame: number;
  time_s: number;
  direction: string | null;
  bbox: number[];
  yolo_class: Category;
  yolo_conf: number;
  alternative: Category | null;
  origin: string;
  n_obs: number;
  filmstrip: string;
  context?: string;
  clip: string;
};

export function hasTracks(jobId: string): boolean {
  return fs.existsSync(path.join(jobDir(jobId), "tracks.json.gz"));
}

/** When the worker wrote the detection preview (the current frame), or null if there is none. */
export function detectionPreview(jobId: string): number | null {
  try {
    return fs.statSync(path.join(jobTempDir(jobId), "preview.jpg")).mtimeMs;
  } catch {
    return null;
  }
}

/** The analysis area (as passed to the worker) the saved tracks were detected with. */
export function tracksArea(jobId: string): string | null {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(jobDir(jobId), "tracks_meta.json"), "utf8"));
    return meta.area_arg ?? null;
  } catch {
    return null; // tracks from before the analysis area: whole frame
  }
}

/**
 * Step 2: detection + candidates (GPU queue) → suggesting. If the detection
 * tracks already exist (lines edited later), only the candidates are redone
 * — minutes instead of repeating the whole detection.
 */
export function startDetection(jobId: string, lines: Line[], area: Area | null, locale: Locale = appLocale()): void {
  const dir = jobDir(jobId);
  const areaArg = area ? [area.x, area.y, area.w, area.h].map((v) => v.toFixed(4)).join(",") : null;
  // tracks of another analysis area are no good: the detection is different
  const candidatesOnly = hasTracks(jobId) && tracksArea(jobId) === areaArg;
  const linesFile = path.join(dir, "lines.json");
  fs.writeFileSync(linesFile, JSON.stringify(lines));
  updateJob(jobId, {
    status: "detecting",
    lines: JSON.stringify(lines),
    area: area ? JSON.stringify(area) : null,
    progress: 0,
    error: null,
    message: msg(candidatesOnly ? "runner.queueCandidates" : "runner.queueGpu"),
  });

  cancelled.delete(jobId);
  void onGpuQueue(async () => {
    if (cancelled.has(jobId) || getJob(jobId)?.status !== "detecting") return;
    await ensureDriveVideo(jobId, jobId, locale, (message, progress) => updateJob(jobId, { message, progress }));
    // review images of the previous detection (before 0.0.10 they were in the job folder)
    for (const d of new Set([dir, jobTempDir(jobId)])) fs.rmSync(path.join(d, "candidates"), { recursive: true, force: true });
    // review images and clips: temporary (the preview goes next to them)
    const output = path.join(jobTempDir(jobId), "candidates");
    const args = ["--video", videoPath(jobId), "--output", output, "--lines", linesFile,
      "--tracks", path.join(dir, "tracks.json.gz"), "--stage", candidatesOnly ? "candidates" : "all"];
    if (areaArg) args.push("--area", areaArg);
    if (process.env.TRAFFIC_COUNTER_END_S) args.push("--end", process.env.TRAFFIC_COUNTER_END_S); // quick tests
    await runWorker("detect.py", args, (ev) => {
      if (ev.type !== "progress") return;
      updateJob(jobId, {
        progress: ev.p,
        message: msg("runner.detectProgress", {
          stage: ev.stage,
          fps: ev.fps != null ? String(ev.fps) : "none",
          candidates: ev.candidates != null ? String(ev.candidates) : "none",
        }),
      });
    }, jobId);

    const items = JSON.parse(fs.readFileSync(path.join(output, "candidates.json"), "utf8")) as WorkerCandidate[];
    replaceCandidates(
      jobId,
      items.map((c) => ({
        track: c.track,
        line_id: c.line_id,
        frame: c.frame,
        time_s: c.time_s,
        direction: c.direction,
        bbox: JSON.stringify(c.bbox),
        yolo_class: c.yolo_class,
        yolo_conf: c.yolo_conf,
        alternative: c.alternative,
        origin: c.origin,
        n_obs: c.n_obs,
        filmstrip: `candidates/${c.filmstrip}`,
        context: c.context ? `candidates/${c.context}` : null,
        clip: `candidates/${c.clip}`,
      })),
    );
    updateJob(jobId, { status: "suggesting", progress: 0, message: msg("runner.candidatesDetected", { n: items.length }) });
    startSuggestions(jobId, locale);
  }).catch((e) => fail(jobId, e));
}

/**
 * Is `file` the video that was processed? Same resolution and the same
 * duration (±1%, at least 2 s). Images or a final video made from another
 * video would come out wrong without any error — two hours of a DVR look
 * alike.
 */
export async function videoMatches(jobId: string, file: string): Promise<boolean | null> {
  const job = getJob(jobId);
  if (!job?.duration_s || !job.width || !job.height) return true; // nothing to compare with yet
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "traffic-counter-check-"));
  let info: { width?: number; height?: number; duration_s?: number } | null = null;
  try {
    await runWorker("info.py", [file, dir], (ev) => {
      if (ev.type === "info") info = ev;
    });
  } catch (e) {
    console.error(`[media] checking ${file}: ${e instanceof Error ? e.message : e}`);
    return null; // could not check (engine missing, Python error): not the same as another video
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const i = info as { width?: number; height?: number; duration_s?: number } | null;
  if (!i) return null;
  return i.width === job.width && i.height === job.height && Math.abs((i.duration_s ?? 0) - job.duration_s) <= Math.max(2, job.duration_s * 0.01);
}

/** Why the last "make the images again" did not run (shown on the video page). */
const rebuildFailures = (g.__tcRebuildFailures ??= new Map<string, "wrongVideo" | "failed">());
export function mediaRebuildFailure(jobId: string): "wrongVideo" | "failed" | null {
  return rebuildFailures.get(jobId) ?? null;
}

/** Review images being made again: job → progress 0–1 (shown on the video page). */
const rebuilding = (g.__tcRebuilding ??= new Map<string, number>());
export function mediaRebuilding(jobId: string): number | null {
  return rebuilding.get(jobId) ?? null;
}

/**
 * Makes the review images and clips again (deleted to free space, cleaned
 * by the system from the temporary folder, or a project opened on another
 * computer) WITHOUT touching the candidates or the decisions: the worker
 * redoes the candidates from the same trajectories and lines into a separate
 * folder, and each existing candidate takes the media of the one at the same
 * track, line and frame. Nothing changes in the job status.
 */
export function rebuildMedia(jobId: string): void {
  const job = getJob(jobId);
  if (!job || rebuilding.has(jobId) || !hasTracks(jobId)) return;
  if (job.drive_id === "local" && !fs.existsSync(videoPath(jobId))) return; // "Locate the video…" first
  rebuilding.set(jobId, 0);
  rebuildFailures.delete(jobId);
  const area = job.area ? (JSON.parse(job.area) as Area) : null;
  void onGpuQueue(async () => {
    // the lines changed or a new detection started after the click: that detection makes the images
    const now = getJob(jobId);
    if (!now || now.status === "detecting" || now.lines !== job.lines || now.area !== job.area) return;
    await ensureDriveVideo(jobId, jobId, appLocale(), (_m, p) => rebuilding.set(jobId, p * 0.1));
    const same = await videoMatches(jobId, videoPath(jobId));
    if (same !== true) {
      rebuildFailures.set(jobId, same === false ? "wrongVideo" : "failed");
      return;
    }
    const temp = jobTempDir(jobId);
    const output = path.join(temp, "candidates.new");
    fs.rmSync(output, { recursive: true, force: true });
    const linesFile = path.join(temp, "lines.json");
    fs.mkdirSync(temp, { recursive: true });
    fs.writeFileSync(linesFile, job.lines);
    const args = ["--video", videoPath(jobId), "--output", output, "--lines", linesFile, "--tracks", path.join(jobDir(jobId), "tracks.json.gz"), "--stage", "candidates"];
    if (area) args.push("--area", [area.x, area.y, area.w, area.h].map((v) => v.toFixed(4)).join(","));
    await runWorker("detect.py", args, (ev) => {
      if (ev.type === "progress") rebuilding.set(jobId, ev.p);
    }, jobId);
    const items = JSON.parse(fs.readFileSync(path.join(output, "candidates.json"), "utf8")) as WorkerCandidate[];
    const final = path.join(temp, "candidates");
    fs.rmSync(final, { recursive: true, force: true });
    fs.renameSync(output, final);
    const byKey = new Map(items.map((c) => [`${c.track}|${c.line_id}|${c.frame}`, c]));
    let matched = 0;
    for (const c of listCandidates(jobId)) {
      const m = byKey.get(`${c.track}|${c.line_id}|${c.frame}`);
      if (!m) continue;
      updateCandidateMedia(c.id, `candidates/${m.filmstrip}`, m.context ? `candidates/${m.context}` : null, `candidates/${m.clip}`);
      matched += 1;
    }
    console.log(`[media] ${jobId}: images made again for ${matched} of ${listCandidates(jobId).filter((c) => c.origin !== "manual").length} candidates`);
  })
    .catch((e) => {
      rebuildFailures.set(jobId, "failed");
      console.error(`[media] ${jobId}: ${e instanceof Error ? e.message : e}`);
    })
    .finally(() => rebuilding.delete(jobId));
}

// ----------------------------------------------------------------------
// Step 3: OpenRouter suggestion for EVERY candidate (project rule: the
// human review only starts when every one has a suggestion).
// ----------------------------------------------------------------------

// OPENROUTER_CONCORRENCIA / OPENROUTER_DICA_YOLO: names before 0.0.8 (lib/env.ts maps them)
const LLM_CONCURRENCY = Number(process.env.OPENROUTER_CONCURRENCY ?? 6);
const LLM_ATTEMPTS = 4;
// YOLO hint off by default: in calibration it did not improve accuracy and
// risks pulling the model towards the detector's typical mistake (night
// cyclist seen as a pedestrian). OPENROUTER_YOLO_HINT=1 turns it on.
const YOLO_HINT = process.env.OPENROUTER_YOLO_HINT === "1";

export function suggestionsRunning(jobId: string): boolean {
  return suggesting.has(jobId);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Suggestions that stopped because of the AI key: a message for
 * non-technical users; the video page recognizes the errors.ai.* keys and
 * offers to open Settings.
 */
function keyError(status: number): string {
  const reason =
    status === 402 ? "noCredits" : status === 403 ? "forbidden" : process.env.OPENROUTER_API_KEY ? "rejected" : "missing";
  return msg(`errors.ai.${reason}`);
}

/** Record of each suggestion failure: in the server log and in suggestion_errors.jsonl in the job folder (goes into the diagnostics report). */
function logSuggestionError(jobId: string, c: Candidate, error: OpenRouterError, attempts: number): string {
  const dir = jobDir(jobId);
  const size = (rel: string | null) => {
    try {
      return rel ? fs.statSync(jobFile(jobId, rel)).size : null;
    } catch {
      return null;
    }
  };
  const record = {
    at: new Date().toISOString(),
    job: jobId,
    candidate: c.id,
    track: c.track,
    status: error.status,
    transient: error.transient,
    attempts,
    message: error.message,
    detail: error.detail,
    models: suggestionModels(),
    filmstrip: c.filmstrip,
    filmstrip_bytes: size(c.filmstrip),
    context: c.context,
    context_bytes: size(c.context),
  };
  const line = JSON.stringify(record);
  console.error(`[suggestions] ${line}`);
  try {
    fs.appendFileSync(path.join(dir, "suggestion_errors.jsonl"), `${line}${EOL}`);
  } catch {}
  return line;
}

export function startSuggestions(jobId: string, locale: Locale = appLocale()): void {
  if (suggesting.has(jobId)) return;
  suggesting.add(jobId);
  void (async () => {
    await moveFinished();
    // A YOLO car on a line that does not count cars (bike lane, sidewalk):
    // the proposal is already to discard and the vision model always agreed
    // (Augusto de Lima: 236 of 236) — the call is not paid for. A motion blob
    // still goes to the model: it may be the cyclist glued to the car.
    const jobLines = new Map((JSON.parse(getJob(jobId)?.lines || "[]") as Line[]).map((l) => [l.id, l]));
    const pending = listCandidates(jobId).filter((c) => {
      if (c.llm_status === "ok") return false;
      if (c.origin === "track" && c.yolo_class === "cars" && c.line_id
          && !countsOnLine(jobLines.get(c.line_id), "cars")) {
        recordSuggestion(c.id, {
          llm_suggestion: "cars", llm_conf: c.yolo_conf, llm_model: NO_CONSULTATION, llm_cost: 0, llm_status: "ok",
          llm_reason: msg("review.noConsultationReason"),
        });
        return false;
      }
      return true;
    });
    for (const c of pending) {
      if (c.llm_status === "failed") {
        recordSuggestion(c.id, {
          llm_suggestion: null, llm_conf: null, llm_reason: null,
          llm_model: null, llm_cost: null, llm_status: "pending",
        });
      }
    }
    let abort: string | null = null;

    const updateProgress = () => {
      const r = suggestionSummary(jobId);
      updateJob(jobId, {
        status: "suggesting",
        progress: r.total ? r.ok / r.total : 1,
        message: msg("runner.suggesting", { ok: r.ok, total: r.total, failed: r.failed, cost: r.cost.toFixed(4) }),
      });
    };
    updateProgress();

    let next = 0;
    const worker = async () => {
      while (!abort && next < pending.length && getJob(jobId)) {
        const c = pending[next++];
        for (let attempt = 1; ; attempt++) {
          try {
            const r = await suggestCategory(
              {
                filmstrip: jobFile(jobId, c.filmstrip ?? ""),
                context: c.context ? jobFile(jobId, c.context) : null,
                detectorHint: YOLO_HINT ? c.yolo_class : null,
              },
              { locale },
            );
            recordSuggestion(c.id, {
              llm_suggestion: r.category,
              llm_conf: r.confidence,
              llm_reason: r.reason,
              llm_model: r.model,
              llm_cost: r.cost_usd,
              llm_status: "ok",
            });
            break;
          } catch (e) {
            const error = e instanceof OpenRouterError ? e : new OpenRouterError(e instanceof Error ? e.message : String(e), null, false, e instanceof Error ? (e.stack ?? null) : null);
            // invalid key / no credits: no point in going on with the batch
            if (error.status === 401 || error.status === 402 || error.status === 403) {
              logSuggestionError(jobId, c, error, attempt);
              abort = keyError(error.status);
              break;
            }
            if (!error.transient || attempt >= LLM_ATTEMPTS) {
              recordSuggestion(c.id, {
                llm_suggestion: null, llm_conf: null, llm_reason: error.message,
                llm_model: null, llm_cost: null, llm_status: "failed",
                llm_error: logSuggestionError(jobId, c, error, attempt),
              });
              break;
            }
            await wait(1000 * 2 ** attempt);
          }
        }
        updateProgress();
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, LLM_CONCURRENCY) }, worker));

    const r = suggestionSummary(jobId);
    if (abort) {
      updateJob(jobId, { status: "error", error: abort, message: null });
    } else if (r.failed > 0 || r.ok < r.total) {
      updateJob(jobId, { message: msg("runner.suggestionsPartial", { ok: r.ok, total: r.total, failed: r.total - r.ok }) });
    } else {
      updateJob(jobId, {
        status: "awaiting_review",
        progress: 1,
        message: msg("runner.suggestionsDone", { total: r.total, cost: r.cost.toFixed(4) }),
      });
    }
  })()
    .catch((e) => fail(jobId, e))
    .finally(() => suggesting.delete(jobId));
}

// ----------------------------------------------------------------------
// Final video: one or more reviewed jobs in a single video, the counter
// adding across them. The plan freezes the human decisions at request time.
// ----------------------------------------------------------------------

/** Texts burned into the final video and the CSV header, in the app language. */
async function renderLabels(locale: Locale) {
  const t = await translatorFor(locale);
  return {
    title: t("render.panelTitle"),
    no_line: t("render.noLine"),
    video_n: t("render.videoN", { n: "{n}", total: "{total}" }),
    plural: Object.fromEntries(CATEGORIES.map((c) => [c, t(`categories.plural.${c}`)])),
    singular: Object.fromEntries(CATEGORIES.map((c) => [c, t(`categories.singular.${c}`)])),
    csv: ["video", "timeInVideo", "timeInFinal", "line", "category", "direction", "candidate"].map((k) => t(`render.csv.${k}`)),
  };
}

export function startRender(renderId: string, locale: Locale = appLocale()): void {
  void (async () => {
    const render = getRender(renderId);
    if (!render) return;
    const dir = renderDir(renderId);
    fs.mkdirSync(dir, { recursive: true });
    // a copy from the Drive deleted to free space (Settings → Storage) is downloaded again
    for (const jobId of JSON.parse(render.jobs) as string[]) {
      await ensureDriveVideo(jobId, renderId, locale, (message, progress) => updateRender(renderId, { status: "queued", message, progress }));
    }
    // categories chosen for this final video (null = all): events of the
    // others stay out of the video, the count and the panel
    const chosen = render.categories ? new Set(JSON.parse(render.categories) as Category[]) : null;
    const included = (c: Category) => !chosen || chosen.has(c);
    const videos = (JSON.parse(render.jobs) as string[]).map((jobId) => {
      const job = getJob(jobId);
      if (!job) throw new Error(msg("errors.jobGone", { id: jobId }));
      const jdir = jobDir(jobId);
      return {
        job: jobId,
        title: job.file_name ?? jobId,
        video: videoPath(job.id),
        tracks: path.join(jdir, "tracks.json.gz"),
        lines: (JSON.parse(job.lines) as Line[]).map((l) => (l.categories?.length ? { ...l, categories: l.categories.filter(included) } : l)),
        events: listCandidates(jobId)
          .filter((c) => c.label && c.label !== "discarded" && included(c.label))
          .map((c) => ({ id: c.id, frame: c.frame, line_id: c.line_id, category: c.label, direction: c.direction, track: c.track })),
      };
    });
    // passages only: the cut categories among the ones in the video
    const hl = parseHighlights(render.highlights);
    const highlights = hl && { ...hl, categories: hl.categories?.filter(included) ?? null };
    if (highlights && !videos.some((v) => v.events.some((e) => !highlights.categories || highlights.categories.includes(e.category as Category)))) {
      throw new Error(msg("renders.errors.noPassages"));
    }
    const planFile = path.join(dir, "plan.json");
    fs.writeFileSync(
      planFile,
      JSON.stringify({ categories: chosen ? [...chosen] : null, highlights, labels: await renderLabels(locale), videos }, null, 1),
    );
    for (const f of ["final_video.mp4", "report.json", "events.csv"]) fs.rmSync(path.join(/* turbopackIgnore: true */ dir, f), { force: true });
    updateRender(renderId, { status: "queued", progress: 0, error: null, message: msg("runner.queueGpu") });

    cancelled.delete(renderId);
    await onGpuQueue(async () => {
      if (cancelled.has(renderId) || getRender(renderId)?.status !== "queued") return;
      updateRender(renderId, { status: "rendering", message: msg("runner.renderStarting") });
      const args = ["--plan", planFile, "--output", dir];
      if (process.env.TRAFFIC_COUNTER_END_S) args.push("--end", process.env.TRAFFIC_COUNTER_END_S); // quick tests
      let done: WorkerEvent | null = null;
      await runWorker("render.py", args, (ev) => {
        if (ev.type === "done") done = ev;
        if (ev.type !== "progress") return;
        updateRender(renderId, {
          progress: ev.p,
          message: msg("runner.renderProgress", {
            video: ev.video ?? 1,
            videos: ev.videos ?? 1,
            fps: ev.fps != null ? String(ev.fps) : "none",
          }),
        });
      }, renderId);
      const d = done as Extract<WorkerEvent, { type: "done" }> | null;
      updateRender(renderId, {
        status: "ready",
        progress: 1,
        message: d ? msg("runner.renderDone", { events: d.events ?? 0, minutes: Math.round((d.duration_s ?? 0) / 60) }) : null,
      });
    });
  })().catch((e) => {
    const error = cancelled.delete(renderId) ? msg("errors.cancelled") : e instanceof Error ? e.message : String(e);
    updateRender(renderId, { status: "error", error, message: null });
  });
}

/**
 * The Drive video of a job whose copy was deleted to free space (Settings →
 * Storage), downloaded again before a step that reads it: a final video, a
 * new detection, the review images made again. `owner` (job or final video)
 * is what Cancel aborts; `report` shows the progress.
 */
async function ensureDriveVideo(jobId: string, owner: string, locale: Locale, report: (message: string, progress: number) => void): Promise<void> {
  const job = getJob(jobId);
  if (!job || job.drive_id === "local" || fs.existsSync(videoPath(jobId))) return;
  const target = videoPath(jobId);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const control = new AbortController();
  downloads.set(owner, control);
  const meter = transferMeter(locale);
  report(msg("runner.downloadingAgain", { name: job.file_name ?? jobId }), 0);
  // .part: a download stopped halfway must not look like the video
  const part = `${target}.part`;
  try {
    await downloadFromDrive(job.drive_id, part, control.signal, (done, total) => report(meter(done, total), total ? done / total : 0));
    fs.renameSync(part, target);
  } finally {
    downloads.delete(owner);
    fs.rmSync(part, { force: true });
  }
}

export function cancelRender(renderId: string): void {
  cancelled.add(renderId);
  downloads.get(renderId)?.abort();
  killProcesses(renderId);
  if (process.platform !== "win32") spawnSync("pkill", ["-f", `worker/render\\.py --plan ${escapeRegExp(path.join(renderDir(renderId), "plan.json"))}`]);
  updateRender(renderId, { status: "error", error: msg("errors.cancelled"), message: null });
}
