"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { msg } from "@/i18n/message";
import { CATEGORIES, createRender, getJob, getRender, reviewSummary, updateRender, type Category } from "@/lib/db";
import { validHighlights, type Highlights } from "@/lib/highlights";
import { cancelRender, startRender } from "@/lib/runner";

/**
 * Why a job cannot go into the final video yet (null = it can), as a stored
 * message naming the video.
 */
function blocker(jobId: string): string | null {
  const job = getJob(jobId);
  const name = job?.file_name ?? jobId;
  if (!job) return msg("renders.errors.missing", { name });
  if (job.status !== "awaiting_review") return msg("renders.errors.notInReview", { name });
  const r = reviewSummary(jobId);
  if (r.reviewed < r.total) return msg("renders.errors.remaining", { name, n: r.total - r.reviewed });
  return null;
}

/** Categories chosen by the user: null = all; [] is an error. */
function validCategories(choice: unknown): { categories: Category[] | null } | { error: string } {
  if (choice == null) return { categories: null };
  if (!Array.isArray(choice)) return { error: msg("renders.errors.invalidCategories") };
  const cats = CATEGORIES.filter((c) => choice.includes(c));
  if (!cats.length) return { error: msg("renders.errors.noCategory") };
  return { categories: cats.length === CATEGORIES.length ? null : cats };
}

/** Passages-only choice, checked against the categories of the video (null = whole video). */
function checkedHighlights(choice: unknown, categories: Category[] | null): { highlights: Highlights | null } | { error: string } {
  const h = validHighlights(choice, categories ?? CATEGORIES);
  return h === undefined ? { error: msg("renders.errors.invalidHighlights") } : { highlights: h };
}

/**
 * Final video with one or more jobs, in the given order; the counter adds
 * across them. Project rule: only after the complete human review of each.
 * `error`: a stored message — show it with formatStored and the root translator.
 */
export async function createFinalVideo(
  jobIds: string[],
  chosenCategories: Category[] | null = null,
  chosenHighlights: Highlights | null = null,
): Promise<{ error?: string }> {
  const ids = [...new Set(jobIds.map(String))].filter((id) => /^[\w-]{1,40}$/.test(id));
  if (!ids.length) return { error: msg("renders.errors.noVideo") };
  const cats = validCategories(chosenCategories);
  if ("error" in cats) return { error: cats.error };
  const hl = checkedHighlights(chosenHighlights, cats.categories);
  if ("error" in hl) return { error: hl.error };
  for (const id of ids) {
    const why = blocker(id);
    if (why) return { error: why };
  }
  const id = randomUUID().slice(0, 8);
  const name = ids.map((j) => getJob(j)?.file_name ?? j).join(" + ").slice(0, 300);
  createRender(id, name, ids, cats.categories, hl.highlights);
  startRender(id);
  refresh(); // exports counter in the side library
  redirect(`/renders/${id}`);
}

/** Generates again with the current review decisions (same videos, same order); the options can change first. */
export async function renderAgain(
  renderId: string,
  chosenCategories?: Category[] | null,
  chosenHighlights?: Highlights | null,
): Promise<{ error?: string }> {
  const render = getRender(renderId);
  if (!render || render.status === "queued" || render.status === "rendering") return {};
  if (chosenCategories !== undefined) {
    const cats = validCategories(chosenCategories);
    if ("error" in cats) return { error: cats.error };
    const hl = checkedHighlights(chosenHighlights ?? null, cats.categories);
    if ("error" in hl) return { error: hl.error };
    updateRender(renderId, {
      categories: cats.categories ? JSON.stringify(cats.categories) : null,
      highlights: hl.highlights ? JSON.stringify(hl.highlights) : null,
    });
  }
  for (const id of JSON.parse(render.jobs) as string[]) {
    const why = blocker(id);
    if (why) return { error: why };
  }
  startRender(renderId);
  refresh();
  return {};
}

export async function cancel(renderId: string): Promise<void> {
  const render = getRender(renderId);
  if (!render || (render.status !== "queued" && render.status !== "rendering")) return;
  cancelRender(renderId);
  refresh();
}
