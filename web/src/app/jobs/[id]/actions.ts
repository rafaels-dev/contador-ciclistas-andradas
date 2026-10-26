"use server";

import fs from "node:fs";
import path from "node:path";
import { refresh } from "next/cache";
import {
  CATEGORIES,
  updateJob,
  listCameras,
  getJob,
  suggestionSummary,
  reviewCandidates,
  saveCamera,
  type Area,
  type Category,
  type Line,
} from "@/lib/db";
import { msg } from "@/i18n/message";
import { LABELS, type Label } from "@/lib/review";
import { jobDir } from "@/lib/paths";
import { cancelJob, startDetection, startDownload, startSuggestions, suggestionsRunning } from "@/lib/runner";

/** Errors come back as message keys (root namespace), translated on screen. */
export type ActionResult = { error?: string };

/** Thrown by the validators: carries a message key, not text. */
class InvalidInput extends Error {}

function validateCategories(input: unknown): Category[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const cats = CATEGORIES.filter((c) => input.includes(c));
  // all checked = no restriction
  return cats.length && cats.length < CATEGORIES.length ? cats : undefined;
}

function validateLines(input: unknown): Line[] {
  if (!Array.isArray(input)) throw new InvalidInput("job.errors.invalidLines");
  return input.map((l, i) => {
    const num = (v: unknown) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 1) throw new InvalidInput("job.errors.outsideFrame");
      return n;
    };
    // the editor always sends a name (in the user's language); this is only a fallback
    return {
      id: String(l.id ?? `l${i + 1}`).slice(0, 40),
      name: String(l.name ?? `${i + 1}`).slice(0, 80) || `${i + 1}`,
      x1: num(l.x1),
      y1: num(l.y1),
      x2: num(l.x2),
      y2: num(l.y2),
      categories: validateCategories(l.categories),
    };
  });
}

/** Analysis area: inside the frame and of a useful size; null = whole frame. */
function validateArea(input: unknown): Area | null {
  if (!input || typeof input !== "object") return null;
  const a = input as Record<string, unknown>;
  const [x, y, w, h] = [a.x, a.y, a.w, a.h].map(Number);
  if (![x, y, w, h].every(Number.isFinite)) throw new InvalidInput("job.errors.invalidArea");
  const area = { x: Math.max(0, x), y: Math.max(0, y), w: Math.min(1 - Math.max(0, x), w), h: Math.min(1 - Math.max(0, y), h) };
  if (area.w < 0.03 || area.h < 0.03) throw new InvalidInput("job.errors.areaTooSmall");
  return area.w > 0.999 && area.h > 0.999 ? null : area;
}

export async function confirmLines(
  jobId: string,
  rawLines: unknown,
  camera: { id: string; name: string } | null,
  rawArea: unknown = null,
): Promise<ActionResult> {
  const job = getJob(jobId);
  if (!job) return { error: "job.errors.notFound" };
  if (job.status !== "awaiting_lines") return { error: "job.errors.notAwaitingLines" };
  let lines: Line[];
  let area: Area | null;
  try {
    lines = validateLines(rawLines);
    area = validateArea(rawArea);
  } catch (e) {
    if (e instanceof InvalidInput) return { error: e.message };
    throw e;
  }
  if (camera?.name.trim()) {
    const id = camera.id || camera.name.trim().toLowerCase().replace(/[^\w]+/g, "-");
    saveCamera(id, camera.name.trim(), lines, area);
    updateJob(jobId, { camera_id: id });
  }
  startDetection(jobId, lines, area);
  refresh();
  return {};
}

export async function retryJob(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job || job.status !== "error") return;
  if (suggestionSummary(jobId).total > 0) {
    // failed at the suggestion step: resume only the candidates without a suggestion
    startSuggestions(jobId);
  } else if (fs.existsSync(path.join(jobDir(jobId), "frame0.jpg"))) {
    // video already downloaded: back to drawing the lines (pre-filled)
    updateJob(jobId, { status: "awaiting_lines", error: null, message: null, progress: 0 });
  } else {
    startDownload(jobId);
  }
  refresh();
}

export async function cancel(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job || !["downloading", "detecting"].includes(job.status)) return;
  cancelJob(jobId);
  refresh();
}

export async function resumeSuggestions(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job || job.status !== "suggesting") return;
  startSuggestions(jobId);
  refresh();
}

/**
 * Opens the review even with candidates without a suggestion (the AI failed
 * on them): the human classifies those by hand, with the detector's proposal.
 * Without this the user was stuck on "Try again" when the failure was persistent.
 */
export async function reviewWithoutSuggestions(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job || job.status !== "suggesting" || suggestionsRunning(jobId)) return;
  const r = suggestionSummary(jobId);
  if (r.ok + r.failed < r.total) return; // still pending: resume the suggestions
  updateJob(jobId, {
    status: "awaiting_review",
    progress: 1,
    message: msg("job.reviewWithoutSuggestionsMessage", { ok: r.ok, total: r.total, failed: r.failed, cost: r.cost.toFixed(4) }),
  });
  refresh();
}

/** Back to the line editor after detection (discards candidates/suggestions/review on confirm). */
export async function editLines(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job || !["suggesting", "awaiting_review", "error"].includes(job.status) || suggestionsRunning(jobId)) return;
  if (!fs.existsSync(path.join(jobDir(jobId), "frame0.jpg"))) return;
  updateJob(jobId, { status: "awaiting_lines", error: null, message: null, progress: 0 });
  refresh();
}

/**
 * Human review decisions. Does not call refresh(): the screen keeps local
 * state to answer each key press immediately; the server only persists.
 */
export async function decide(jobId: string, decisions: { id: number; label: Label | null }[]): Promise<ActionResult> {
  const job = getJob(jobId);
  if (!job) return { error: "job.errors.notFound" };
  if (job.status !== "awaiting_review") return { error: "job.errors.reviewClosed" };
  if (!Array.isArray(decisions) || decisions.some((d) => !Number.isInteger(d?.id) || (d.label !== null && !LABELS.includes(d.label)))) {
    return { error: "job.errors.invalidDecision" };
  }
  reviewCandidates(jobId, decisions);
  return {};
}

/**
 * Changes only the categories counted per line, without redoing candidates or
 * suggestions (the discard proposal is computed on screen). Also updates the
 * saved camera, for its next videos.
 */
export async function setLineCategories(jobId: string, map: Record<string, string[]>): Promise<void> {
  const job = getJob(jobId);
  if (!job || !["suggesting", "awaiting_review"].includes(job.status)) return;
  const apply = (lines: Line[]) => lines.map((l) => (l.id in map ? { ...l, categories: validateCategories(map[l.id]) } : l));
  updateJob(jobId, { lines: JSON.stringify(apply(JSON.parse(job.lines) as Line[])) });
  const cam = job.camera_id ? listCameras().find((c) => c.id === job.camera_id) : undefined;
  if (cam) saveCamera(cam.id, cam.name, apply(JSON.parse(cam.lines) as Line[]));
  refresh();
}
