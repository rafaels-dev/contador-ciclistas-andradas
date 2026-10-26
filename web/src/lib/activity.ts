import { listJobs, listRenders, type Job, type Render } from "./db";
import { installState } from "./engine";
import { INSTALL_STEPS } from "./install-steps";
import { suggestionsRunning } from "./runner";
import { statusKey } from "./status";

/** Step in progress, with a live process: shows a bar and a message and refreshes the screen. */
export function jobWorking(job: Job): boolean {
  return job.status === "downloading" || job.status === "detecting" || (job.status === "suggesting" && suggestionsRunning(job.id));
}

export function renderWorking(r: Render): boolean {
  return r.status === "queued" || r.status === "rendering";
}

/** Texts are message keys or stored messages (translated by the panel). */
export type Task = {
  key: string;
  href: string;
  name: string;
  /** message key (tasks.*, status.*) with optional values */
  stage: { key: string; values?: Record<string, string | number> };
  /** 0–1, or null when it cannot be measured */
  progress: number | null;
  message: string | null;
  /** waiting for its turn on the GPU (one detection/final video at a time) */
  queued: boolean;
};

/** Everything running now: downloads, detections, suggestions, final videos and the engine installation. */
export function tasksInProgress(): Task[] {
  const tasks: Task[] = [];
  const inst = installState();
  if (inst.running) {
    tasks.push({
      key: "engine",
      href: "/settings",
      name: "engine",
      stage: inst.step ? { key: "tasks.installing", values: { step: inst.step, total: INSTALL_STEPS } } : { key: "tasks.updating" },
      progress: null,
      message: inst.stage,
      queued: false,
    });
  }
  for (const r of listRenders().filter(renderWorking)) {
    const queued = r.status === "queued";
    tasks.push({ key: `r${r.id}`, href: `/renders/${r.id}`, name: r.name, stage: { key: queued ? "tasks.renderQueued" : "tasks.rendering" }, progress: queued ? null : r.progress, message: r.message, queued });
  }
  for (const j of listJobs().filter(jobWorking)) {
    const queued = j.status === "detecting" && j.message?.includes("runner.queue") === true;
    tasks.push({ key: `j${j.id}`, href: `/jobs/${j.id}`, name: j.file_name ?? j.drive_id, stage: { key: queued ? "tasks.detectionQueued" : statusKey(j) }, progress: queued ? null : j.progress, message: j.message, queued });
  }
  // running first, then the queue
  return tasks.sort((a, b) => Number(a.queued) - Number(b.queued));
}
